export const MSG = {
  VAULT_STATUS: "VAULT_STATUS",
  VAULT_CREATE: "VAULT_CREATE",
  VAULT_UNLOCK: "VAULT_UNLOCK",
  VAULT_LOCK: "VAULT_LOCK",

  ENTRY_LIST: "ENTRY_LIST",
  ENTRY_UPSERT: "ENTRY_UPSERT",
  ENTRY_DELETE: "ENTRY_DELETE",
  ENTRY_GET_SECRET: "ENTRY_GET_SECRET",

  GENERATE_PASSWORD: "GENERATE_PASSWORD",
  HIBP_CHECK: "HIBP_CHECK",
} as const;

export type MsgType = (typeof MSG)[keyof typeof MSG];

export type ApiErrorCode =
  | "NO_VAULT"
  | "LOCKED"
  | "BAD_MASTER"
  | "WEAK_MASTER"
  | "LEAKED_MASTER"  // SECURITY FIX #6: Master password filtrada (HIBP check)
  | "RATE_LIMITED"   // SECURITY FIX #3: Demasiados intentos de unlock
  | "NOT_FOUND"
  | "VALIDATION"
  | "INTERNAL"
  | "FORBIDDEN"      // SECURITY FIX #5: Mensaje desde origen no autorizado
  | "UNKNOWN_MESSAGE";

export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ApiErrorCode; message: string } };

export type VaultStatusRes = { hasVault: boolean; locked: boolean };

export type VaultCreateReq = { type: typeof MSG.VAULT_CREATE; master: string; vaultName?: string };
export type VaultUnlockReq = { type: typeof MSG.VAULT_UNLOCK; master: string };
export type VaultLockReq = { type: typeof MSG.VAULT_LOCK };
export type VaultStatusReq = { type: typeof MSG.VAULT_STATUS };

export type EntryListReq = { type: typeof MSG.ENTRY_LIST };
export type EntryUpsertReq = { type: typeof MSG.ENTRY_UPSERT; entry: any };
export type EntryDeleteReq = { type: typeof MSG.ENTRY_DELETE; id: string };
export type EntryGetSecretReq = { type: typeof MSG.ENTRY_GET_SECRET; id: string };

export type GeneratePasswordReq = {
  type: typeof MSG.GENERATE_PASSWORD;
  config: {
    length: number;
    lower?: boolean;
    upper?: boolean;
    digits?: boolean;
    symbols?: boolean;
    avoidAmbiguous?: boolean;
  };
};

export type HibpCheckReq = { type: typeof MSG.HIBP_CHECK; password: string };

export type RequestMessage =
  | VaultStatusReq
  | VaultCreateReq
  | VaultUnlockReq
  | VaultLockReq
  | EntryListReq
  | EntryUpsertReq
  | EntryDeleteReq
  | EntryGetSecretReq
  | GeneratePasswordReq
  | HibpCheckReq;