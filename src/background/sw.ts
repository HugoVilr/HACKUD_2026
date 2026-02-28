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
  MESSAGE_TYPES.HIBP_AUDIT_STATUS,
  MESSAGE_TYPES.HIBP_AUDIT_RESULT,
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
    sendResponse({
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: "Invalid message origin",
      },
    });
    return true;
  }

  const extensionOrigin = `chrome-extension://${chrome.runtime.id}`;
  const senderUrl = String(sender.url ?? "");
  const senderTabUrl = String((sender.tab as { url?: string } | undefined)?.url ?? "");
  const senderOrigin = String(
    // origin/documentOrigin no siempre están tipados en @types/chrome según versión.
    (sender as { origin?: string; documentOrigin?: string }).origin ??
      (sender as { origin?: string; documentOrigin?: string }).documentOrigin ??
      ""
  );
  const isExtensionPage =
    senderUrl.startsWith(extensionOrigin) ||
    senderOrigin.startsWith(extensionOrigin) ||
    senderTabUrl.startsWith(extensionOrigin);
  const isWebContentScript = Boolean(sender.tab) && !isExtensionPage;

  // Solo aplicar allowlist estricta a content scripts inyectados en páginas web.
  // Las páginas internas de la extensión (popup/report/options), aunque tengan sender.tab,
  // deben tener acceso completo como trusted UI.
  if (isWebContentScript) {
    const type = message?.type;
    if (!type || !CONTENT_SCRIPT_ALLOWED_TYPES.has(type)) {
      console.warn("[G8keeper] Blocked content-script message", {
        type,
        senderUrl,
        senderTabUrl,
        senderOrigin,
        hasTab: Boolean(sender.tab),
      });
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
      sendResponse({ ok: false, error: { code: "UNHANDLED_ERROR", message: msg } });
    });

  return true;
});
