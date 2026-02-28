import type { AnyRequestMessage, MessageResponseMap, MessageType } from "../shared/messages.ts";
import { handleMessage } from "./session.ts";

chrome.runtime.onMessage.addListener((message: AnyRequestMessage, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => {
      sendResponse(result as MessageResponseMap[MessageType]);
    })
    .catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      sendResponse({ ok: false, error: { code: "UNHANDLED_ERROR", message: msg } });
    });

  return true;
});
