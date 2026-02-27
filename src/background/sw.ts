import { MSG } from "../shared/messages";
import { handleMessage } from "./session";

chrome.runtime.onMessage.addListener((message: any, _sender, sendResponse) => {
  (async () => {
    try {
      const res = await handleMessage(message);
      sendResponse(res);
    } catch {
      sendResponse({ ok: false, error: { code: "INTERNAL", message: "Error interno" } });
    }
  })();

  return true; // async
});