import type { VaultEntry } from "../../../core/vault/types.ts";
import type { EntrySecret, PopupState, ToastTone } from "../state/popupState.ts";

export type ApiResponse = {
  ok: boolean;
  error?: { code?: string; message?: string };
  data?: any;
};

export type HandlerDeps = {
  root: HTMLElement;
  state: PopupState;
  render: () => void;
  setToast: (message: string, tone?: ToastTone) => void;
  sendApiMessage: (type: string, payload?: unknown) => Promise<ApiResponse>;
  refreshStatus: () => Promise<void>;
  refreshEntries: () => Promise<boolean>;
  ensureSelectedSecret: () => Promise<EntrySecret | null>;
  saveRecoveryCodesContext: () => Promise<void>;
  consumeSignupUnlockContext: () => Promise<boolean>;
  getSelectedEntry: () => VaultEntry | null;
  selectEntry: (entryId: string) => void;
  copyText: (value: string) => Promise<void>;
  recoveryCodesKey: string;
};
