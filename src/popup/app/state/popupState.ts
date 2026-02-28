import type { VaultEntry } from "../../../core/vault/types.ts";

export type PopupRoute = "NO_VAULT" | "LOCKED" | "UNLOCKED";
export type PopupScreen = "LIST" | "DETAIL" | "FORM_ADD" | "FORM_EDIT";
export type ToastTone = "info" | "success" | "error";

export type EntrySecret = {
  id: string;
  username?: string;
  password: string;
};

export type PopupState = {
  route: PopupRoute;
  screen: PopupScreen;
  vaultName: string;
  search: string;
  selectedEntryId: string | null;
  formPasswordVisible: boolean;
  detailPasswordVisible: boolean;
  selectedSecret: EntrySecret | null;
  unlockMasterDraft: string;
  toastMessage: string;
  toastTone: ToastTone;
  entries: VaultEntry[];
  showDeleteConfirm: boolean;
  recoveryCodes: string[] | null;
  recoveryCodesAcknowledged: boolean;
  recoveryCodesSaved: boolean;
  showRecoveryCodeUnlock: boolean;
};

export const POPUP_CONTEXT_KEY = "g8keeper_popup_context";
export const RECOVERY_CODES_KEY = "g8keeper_recovery_codes_context";

export const routeLabels: Record<PopupRoute, string> = {
  NO_VAULT: "No Vault",
  LOCKED: "Locked",
  UNLOCKED: "Unlocked",
};

export const createInitialPopupState = (): PopupState => {
  return {
    route: "NO_VAULT",
    screen: "LIST",
    vaultName: "",
    search: "",
    selectedEntryId: null,
    formPasswordVisible: false,
    detailPasswordVisible: false,
    selectedSecret: null,
    unlockMasterDraft: "",
    toastMessage: "",
    toastTone: "info",
    entries: [],
    showDeleteConfirm: false,
    recoveryCodes: null,
    recoveryCodesAcknowledged: false,
    recoveryCodesSaved: false,
    showRecoveryCodeUnlock: false,
  };
};
