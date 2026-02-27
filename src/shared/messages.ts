export type MessageType =
  | "vault:create"
  | "vault:unlock"
  | "vault:lock"
  | "vault:get"
  | "entry:create"
  | "entry:update"
  | "entry:delete";

export interface Message<TPayload = unknown> {
  type: MessageType;
  payload?: TPayload;
}
