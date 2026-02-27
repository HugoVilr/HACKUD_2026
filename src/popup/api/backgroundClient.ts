import type { ApiResponse, RequestMessage } from "../../shared/messages";

export function sendToBackground<T>(msg: RequestMessage): Promise<ApiResponse<T>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res: ApiResponse<T>) => resolve(res));
  });
}