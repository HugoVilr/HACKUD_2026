import type { Message } from "../shared/messages";

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  // TODO: route message to session/core handlers.
  sendResponse({ ok: true, messageType: message.type });
  return true;
});
