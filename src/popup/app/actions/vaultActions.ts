import { getSelectedEntry, setRoute } from "../state/popupStore.ts";
import {
  POPUP_CONTEXT_KEY,
  RECOVERY_CODES_KEY,
  type PopupState,
  type ToastTone,
} from "../state/popupState.ts";

type PopupActionDeps = {
  render: () => void;
  setToast: (message: string, tone?: ToastTone) => void;
};

type ApiResponse = {
  ok: boolean;
  error?: { message?: string };
  data?: any;
};

export const sendApiMessage = async (type: string, payload?: unknown): Promise<ApiResponse> => {
  const message = payload === undefined ? { type } : { type, payload };
  const res = (await chrome.runtime.sendMessage(message)) as ApiResponse;
  if (!res || typeof res.ok !== "boolean") {
    throw new Error("api-bad-response");
  }
  return res;
};

export const consumeSignupUnlockContext = async (): Promise<boolean> => {
  try {
    const data = await chrome.storage.session.get(POPUP_CONTEXT_KEY);
    const context = data?.[POPUP_CONTEXT_KEY];
    if (!context || typeof context !== "object") {
      return false;
    }
    const isSignupContext = (context as { source?: string }).source === "signup";
    const expiresAt = Number((context as { expiresAt?: number }).expiresAt || 0);
    const isExpired = !Number.isFinite(expiresAt) || expiresAt < Date.now();
    await chrome.storage.session.remove(POPUP_CONTEXT_KEY);
    return isSignupContext && !isExpired;
  } catch {
    return false;
  }
};

export const saveRecoveryCodesContext = async (state: PopupState): Promise<void> => {
  if (!state.recoveryCodes || state.recoveryCodes.length === 0) {
    await chrome.storage.session.remove(RECOVERY_CODES_KEY);
    return;
  }

  await chrome.storage.session.set({
    [RECOVERY_CODES_KEY]: {
      codes: state.recoveryCodes,
      acknowledged: state.recoveryCodesAcknowledged,
      saved: state.recoveryCodesSaved,
      vaultName: state.vaultName,
    },
  });
};

export const restoreRecoveryCodesContext = async (state: PopupState): Promise<void> => {
  try {
    const data = await chrome.storage.session.get(RECOVERY_CODES_KEY);
    const context = data?.[RECOVERY_CODES_KEY] as
      | { codes?: string[]; acknowledged?: boolean; saved?: boolean; vaultName?: string }
      | undefined;

    if (context && Array.isArray(context.codes) && context.codes.length > 0) {
      state.recoveryCodes = context.codes;
      state.recoveryCodesAcknowledged = Boolean(context.acknowledged);
      state.recoveryCodesSaved = Boolean(context.saved);
      if (context.vaultName) {
        state.vaultName = context.vaultName;
      }
    }
  } catch {
    // Non-critical context restore
  }
};

export const refreshEntries = async (state: PopupState, deps: PopupActionDeps): Promise<boolean> => {
  const res = await sendApiMessage("ENTRY_LIST");
  if (!res.ok) {
    state.entries = [];
    deps.render();
    deps.setToast(res.error?.message || "No se pudieron cargar las entries.", "error");
    return false;
  }

  state.entries = Array.isArray(res.data?.entries) ? res.data.entries : [];
  deps.render();
  return true;
};

export const refreshStatus = async (state: PopupState, deps: PopupActionDeps): Promise<void> => {
  const res = await sendApiMessage("VAULT_STATUS");
  if (!res.ok) {
    deps.render();
    deps.setToast(res.error?.message || "No se pudo obtener el estado del vault.", "error");
    return;
  }

  state.vaultName = res.data?.vaultName || "";

  if (state.recoveryCodes && state.recoveryCodes.length > 0) {
    return;
  }

  if (!res.data?.hasVault) {
    setRoute(state, "NO_VAULT");
    state.entries = [];
    deps.render();
    return;
  }

  if (res.data?.locked) {
    setRoute(state, "LOCKED");
    state.entries = [];
    deps.render();
    return;
  }

  setRoute(state, "UNLOCKED");
  await refreshEntries(state, deps);
};

export const ensureSelectedSecret = async (
  state: PopupState,
  deps: PopupActionDeps,
): Promise<PopupState["selectedSecret"]> => {
  const id = state.selectedEntryId;
  if (!id) {
    return null;
  }

  if (state.selectedSecret?.id === id) {
    return state.selectedSecret;
  }

  const res = await sendApiMessage("ENTRY_GET_SECRET", { id });
  if (!res.ok) {
    deps.setToast(res.error?.message || "No se pudo obtener el secreto.", "error");
    return null;
  }

  const selected = getSelectedEntry(state);
  const usernameFallback = selected?.username;
  const password = String(res.data?.secret?.password || "");
  if (!password) {
    state.selectedSecret = null;
    return null;
  }

  state.selectedSecret = {
    id,
    username: String(res.data?.secret?.username || usernameFallback || "") || undefined,
    password,
  };
  deps.render();
  return state.selectedSecret;
};
