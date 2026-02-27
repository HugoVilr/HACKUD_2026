import type { Message } from "../../shared/messages";

export const sendMessage = <TResponse = unknown>(message: Message): Promise<TResponse> => {
  return chrome.runtime.sendMessage(message) as Promise<TResponse>;
};
