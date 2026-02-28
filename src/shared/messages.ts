import type { VaultEntry } from "../core/vault/types.ts";

export const MESSAGE_TYPES = {
  VAULT_CREATE: "VAULT_CREATE",
  VAULT_UNLOCK: "VAULT_UNLOCK",
  VAULT_LOCK: "VAULT_LOCK",
  VAULT_DELETE: "VAULT_DELETE",
  VAULT_STATUS: "VAULT_STATUS",
  ENTRY_LIST: "ENTRY_LIST",
  ENTRY_GET: "ENTRY_GET",
  ENTRY_ADD: "ENTRY_ADD",
  ENTRY_UPDATE: "ENTRY_UPDATE",
  ENTRY_DELETE: "ENTRY_DELETE",
  ENTRY_GET_SECRET: "ENTRY_GET_SECRET",
  AUTOFILL_QUERY_BY_DOMAIN: "AUTOFILL_QUERY_BY_DOMAIN",
  UI_OPEN_POPUP: "UI_OPEN_POPUP",
  GENERATE_PASSWORD: "GENERATE_PASSWORD",
  /**
   * HIBP Pwned Passwords (k-anonymity) check.
   * Implemented as a background message so `fetch` runs from the MV3 service worker
   * (and uses `host_permissions`).
   */
  HIBP_CHECK: "HIBP_CHECK",
  HIBP_AUDIT_START: "HIBP_AUDIT_START",
  HIBP_AUDIT_STATUS: "HIBP_AUDIT_STATUS",
  HIBP_AUDIT_RESULT: "HIBP_AUDIT_RESULT",
  HIBP_AUDIT_SCHEDULE: "HIBP_AUDIT_SCHEDULE",
  /**
   * AUTO-CAPTURE: Abrir popup para crear cuenta desde vault
   * Usado por content script cuando detecta formulario de signup
   */
  OPEN_POPUP_FOR_SIGNUP: "OPEN_POPUP_FOR_SIGNUP",
  /**
   * AUTO-CAPTURE: Rellenar formulario con credenciales
   * Enviado desde background a content script después de crear entrada
   */
  AUTOFILL_CREDENTIALS: "AUTOFILL_CREDENTIALS",
  /**
   * AUTO-CAPTURE: Solicitar autofill en pestaña activa
   * Enviado desde popup a background después de crear entrada
   */
  REQUEST_AUTOFILL: "REQUEST_AUTOFILL",
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

export interface VaultDeletePayload {
  masterPassword: string;
  confirmText: string;
}

export interface EntryListPayload {
  query?: string;
}

export interface EntryGetPayload {
  id: string;
}

export interface EntryGetSecretPayload {
  id: string;
}

export interface EntryCreateInput {
  title: string;
  domain?: string;
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

export interface HibpCheckPayload {
  /** Plaintext password to check; only the SHA-1 prefix is sent to HIBP. */
  password: string;
}

export interface HibpAuditQueryPayload {
  auditId: string;
}

export type HibpAuditState = "running" | "done" | "failed" | "aborted";

export interface HibpAuditSummary {
  auditId: string;
  state: HibpAuditState;
  startedAt: number;
  finishedAt?: number;
  total: number;
  processed: number;
  compromised: number;
  safe: number;
  errors: number;
  domainPwned: number;
  domainSafe: number;
  domainErrors: number;
  domainSkipped: number;
}

export interface HibpAuditItem {
  entryId: string;
  title: string;
  count: number | null;
  compromised: boolean;
  status: "ok" | "error";
  error?: string;
  domain?: string;
  domainStatus: "pwned" | "safe" | "error" | "skipped";
  domainBreachCount: number | null;
  domainBreaches?: string[];
  domainError?: string;
}

export interface HibpAuditScheduleData {
  intervalHours: number;
  lastAuditAt?: number;
  lastAuditId?: string;
  lastAuditState?: HibpAuditState;
  nextAuditAt: number;
  pending: boolean;
  now: number;
}

export interface GeneratePasswordPayload {
  config: {
    length: number;
    lower?: boolean;
    upper?: boolean;
    digits?: boolean;
    symbols?: boolean;
    avoidAmbiguous?: boolean;
  };
}

export interface AutofillQueryByDomainPayload {
  hostname: string;
}

export interface AutofillCandidate {
  id: string;
  title: string;
  username?: string;
  domain?: string;
  matchType: "exact" | "suffix" | "title";
}

export interface OpenPopupForSignupPayload {
  url: string;
  title: string;
}

export interface AutofillCredentialsPayload {
  username: string;
  password: string;
}

export interface RequestAutofillPayload {
  username: string;
  password: string;
}

export interface UiOpenPopupPayload {
  source?: "signup";
}

export interface MessagePayloadMap {
  VAULT_CREATE: VaultCreatePayload;
  VAULT_UNLOCK: VaultUnlockPayload;
  VAULT_LOCK: undefined;
  VAULT_DELETE: VaultDeletePayload;
  VAULT_STATUS: undefined;
  ENTRY_LIST: EntryListPayload | undefined;
  ENTRY_GET: EntryGetPayload;
  ENTRY_GET_SECRET: EntryGetSecretPayload;
  ENTRY_ADD: EntryAddPayload;
  ENTRY_UPDATE: EntryUpdatePayload;
  ENTRY_DELETE: EntryDeletePayload;
  AUTOFILL_QUERY_BY_DOMAIN: AutofillQueryByDomainPayload;
  UI_OPEN_POPUP: UiOpenPopupPayload | undefined;
  GENERATE_PASSWORD: GeneratePasswordPayload;
  HIBP_CHECK: HibpCheckPayload;
  HIBP_AUDIT_START: undefined;
  HIBP_AUDIT_STATUS: HibpAuditQueryPayload;
  HIBP_AUDIT_RESULT: HibpAuditQueryPayload;
  HIBP_AUDIT_SCHEDULE: undefined;
  OPEN_POPUP_FOR_SIGNUP: OpenPopupForSignupPayload;
  AUTOFILL_CREDENTIALS: AutofillCredentialsPayload;
  REQUEST_AUTOFILL: RequestAutofillPayload;
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
  VAULT_DELETE: ApiResult<{ deleted: boolean }>;
  VAULT_STATUS: ApiResult<VaultStatusData>;
  ENTRY_LIST: ApiResult<{ entries: VaultEntry[] }>;
  ENTRY_GET: ApiResult<{ entry: VaultEntry | null }>;
  ENTRY_GET_SECRET: ApiResult<{ secret: { id: string; username: string; password: string } }>;
  ENTRY_ADD: ApiResult<{ entry: VaultEntry }>;
  ENTRY_UPDATE: ApiResult<{ entry: VaultEntry }>;
  ENTRY_DELETE: ApiResult<{ id: string }>;
  AUTOFILL_QUERY_BY_DOMAIN: ApiResult<{ entries: AutofillCandidate[] }>;
  UI_OPEN_POPUP: ApiResult<{ opened: boolean }>;
  GENERATE_PASSWORD: ApiResult<{ password: string }>;
  HIBP_CHECK: ApiResult<{ count: number }>;
  HIBP_AUDIT_START: ApiResult<{ auditId: string; total: number; startedAt: number }>;
  HIBP_AUDIT_STATUS: ApiResult<{ audit: HibpAuditSummary }>;
  HIBP_AUDIT_RESULT: ApiResult<{ audit: HibpAuditSummary; items: HibpAuditItem[] }>;
  HIBP_AUDIT_SCHEDULE: ApiResult<{ schedule: HibpAuditScheduleData }>;
  OPEN_POPUP_FOR_SIGNUP: ApiResult<{ opened: boolean }>;
  AUTOFILL_CREDENTIALS: ApiResult<{ filled: boolean }>;
  REQUEST_AUTOFILL: ApiResult<{ sent: boolean }>;
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
