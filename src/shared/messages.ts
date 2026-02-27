import type { VaultEntry } from "../core/vault/types";

export const MESSAGE_TYPES = {
  VAULT_CREATE: "VAULT_CREATE",
  VAULT_UNLOCK: "VAULT_UNLOCK",
  VAULT_LOCK: "VAULT_LOCK",
  VAULT_STATUS: "VAULT_STATUS",
  ENTRY_LIST: "ENTRY_LIST",
  ENTRY_GET: "ENTRY_GET",
  ENTRY_ADD: "ENTRY_ADD",
  ENTRY_UPDATE: "ENTRY_UPDATE",
  ENTRY_DELETE: "ENTRY_DELETE"
} as const;

export type MessageType = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];

export interface ApiError {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export interface ApiSuccess<TData> {
  ok: true;
  data: TData;
}

export type ApiResult<TData> = ApiSuccess<TData> | ApiError;

export interface VaultCreatePayload {
  masterPassword: string;
  confirmPassword: string;
  vaultName?: string;
}

export interface VaultUnlockPayload {
  masterPassword: string;
}

export interface EntryListPayload {
  query?: string;
}

export interface EntryGetPayload {
  id: string;
}

export interface EntryCreateInput {
  title: string;
  username?: string;
  password: string;
  notes?: string;
}

export interface EntryAddPayload {
  entry: EntryCreateInput;
}

export interface EntryUpdatePayload {
  entry: VaultEntry;
}

export interface EntryDeletePayload {
  id: string;
}

export interface MessagePayloadMap {
  VAULT_CREATE: VaultCreatePayload;
  VAULT_UNLOCK: VaultUnlockPayload;
  VAULT_LOCK: undefined;
  VAULT_STATUS: undefined;
  ENTRY_LIST: EntryListPayload | undefined;
  ENTRY_GET: EntryGetPayload;
  ENTRY_ADD: EntryAddPayload;
  ENTRY_UPDATE: EntryUpdatePayload;
  ENTRY_DELETE: EntryDeletePayload;
}

export interface VaultStatusData {
  hasVault: boolean;
  locked: boolean;
  vaultName?: string;
  entryCount: number;
}

export interface MessageResponseMap {
  VAULT_CREATE: ApiResult<VaultStatusData>;
  VAULT_UNLOCK: ApiResult<VaultStatusData>;
  VAULT_LOCK: ApiResult<VaultStatusData>;
  VAULT_STATUS: ApiResult<VaultStatusData>;
  ENTRY_LIST: ApiResult<{ entries: VaultEntry[] }>;
  ENTRY_GET: ApiResult<{ entry: VaultEntry | null }>;
  ENTRY_ADD: ApiResult<{ entry: VaultEntry }>;
  ENTRY_UPDATE: ApiResult<{ entry: VaultEntry }>;
  ENTRY_DELETE: ApiResult<{ id: string }>;
}

export type PayloadFor<TType extends MessageType> = MessagePayloadMap[TType];
export type ResponseFor<TType extends MessageType> = MessageResponseMap[TType];

export type RequestMessage<TType extends MessageType = MessageType> =
  PayloadFor<TType> extends undefined
    ? { type: TType; payload?: undefined }
    : { type: TType; payload: PayloadFor<TType> };

export type AnyRequestMessage = {
  [TType in MessageType]: RequestMessage<TType>;
}[MessageType];
