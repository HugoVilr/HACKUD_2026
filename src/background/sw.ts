import type { AnyRequestMessage, MessageResponseMap, MessageType } from "../shared/messages.ts";
import { handleMessage } from "./session.ts";
import { MESSAGE_TYPES } from "../shared/messages.ts";

const POPUP_CONTEXT_KEY = "g8keeper_popup_context";

/**
 * SECURITY FIX #18: Validación de origen de mensajes
 *
 * - Validar sender.id === chrome.runtime.id
 * - Permitir solo una allowlist explícita desde content scripts
 * - Bloquear cualquier operación no autorizada desde páginas web
 */
const CONTENT_SCRIPT_ALLOWED_TYPES = new Set<string>([
  MESSAGE_TYPES.VAULT_STATUS,
  MESSAGE_TYPES.AUTOFILL_QUERY_BY_DOMAIN,
  MESSAGE_TYPES.ENTRY_GET_SECRET,
  MESSAGE_TYPES.UI_OPEN_POPUP,
  MESSAGE_TYPES.OPEN_POPUP_FOR_SIGNUP,
  MESSAGE_TYPES.GENERATE_PASSWORD,
  MESSAGE_TYPES.ENTRY_ADD,
]);

async function dispatchMessage(message: AnyRequestMessage): Promise<MessageResponseMap[MessageType]> {
  if (message.type === MESSAGE_TYPES.UI_OPEN_POPUP) {
    try {
      const source = message.payload?.source;
      if (source === "signup") {
        await chrome.storage.session.set({
          [POPUP_CONTEXT_KEY]: {
            source: "signup",
            expiresAt: Date.now() + 120_000,
          },
        });
      }
      await chrome.action.openPopup();
      return { ok: true, data: { opened: true } } as MessageResponseMap[MessageType];
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: { code: "POPUP_OPEN_FAILED", message: msg } } as MessageResponseMap[MessageType];
    }
  }

  return handleMessage(message);
}

chrome.runtime.onMessage.addListener((message: AnyRequestMessage, sender, sendResponse) => {
  if (!sender.id || sender.id !== chrome.runtime.id) {
    console.warn('[sw] FORBIDDEN: Invalid message origin');
    sendResponse({
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: "Invalid message origin",
      },
    });
    return true;
  }

  if (sender.tab) {
    const type = message?.type;
    if (!type || !CONTENT_SCRIPT_ALLOWED_TYPES.has(type)) {
      console.warn('[sw] FORBIDDEN: Content script not allowed for message type:', type);
      sendResponse({
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: "Content scripts are not allowed to communicate with vault",
        },
      });
      return true;
    }
  }

  dispatchMessage(message)
    .then((result) => {
      sendResponse(result as MessageResponseMap[MessageType]);
    })
    .catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[sw] Dispatch error:', msg, e);
      sendResponse({ ok: false, error: { code: "UNHANDLED_ERROR", message: msg } });
    });

  return true;
});
