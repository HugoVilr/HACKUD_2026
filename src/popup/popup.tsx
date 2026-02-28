import {
  consumeSignupUnlockContext,
  ensureSelectedSecret as loadSelectedSecret,
  refreshEntries as loadEntries,
  refreshStatus as loadStatus,
  restoreRecoveryCodesContext as restoreRecoveryCodes,
  saveRecoveryCodesContext as saveRecoveryCodes,
  sendApiMessage,
} from "./app/actions/vaultActions.ts";
import { attachPopupClickHandler, attachPopupSubmitHandler } from "./app/handlers/popupHandlers.ts";
import { createInitialPopupState, RECOVERY_CODES_KEY, routeLabels, type ToastTone } from "./app/state/popupState.ts";
import { getSelectedEntry as readSelectedEntry, selectEntry as setSelectedEntry } from "./app/state/popupStore.ts";
import { renderRouteBody } from "./ui/screens/renderers.ts";

const state = createInitialPopupState();

const root = document.getElementById("app");
if (!root) {
  throw new Error("Popup root not found");
}

const ASCII_ART = `
                                               
 (        (          )                         
 )\\ )     )\\ (    ( /(   (   (         (  (    
(()/(    ((_))\\   )\\()) ))\\ ))\\  )   ))\\ )(   
 /(_))_    _((_) ((_ )\\ /((_)((_)(/(  /((_|()\\  
(_)) __|  ( _ )  | |(_|_))(_))((_)_\\(_))  ((_) 
  | (_ |  / _ \\  | / // -_) -_) '_ \\) -_)| '_| 
   \\___|  \\___/  |_\\_\\\\___\\___| .__/\\___||_|   
                              |_|              
`;

let toastTimeoutId: number | null = null;

const escapeHtml = (value: unknown): string => {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
};

const maskPassword = (value: string): string => {
  if (!value) {
    return "-";
  }
  return "*".repeat(Math.max(8, value.length));
};

const focusUnlockInput = (): void => {
  if (state.route !== "LOCKED") {
    return;
  }

  const unlockInput = root.querySelector('form[data-action="unlock-vault"] input[name="master"]');
  if (!(unlockInput instanceof HTMLInputElement)) {
    return;
  }

  unlockInput.focus();
  const caret = unlockInput.value.length;
  unlockInput.setSelectionRange(caret, caret);
};

const copyText = async (value: string): Promise<void> => {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!ok) {
    throw new Error("copy-failed");
  }
};

const setToast = (message: string, tone: ToastTone = "info"): void => {
  state.toastMessage = message;
  state.toastTone = tone;
  render();

  if (toastTimeoutId) {
    clearTimeout(toastTimeoutId);
  }
  toastTimeoutId = setTimeout(() => {
    state.toastMessage = "";
    state.toastTone = "info";
    render();
    toastTimeoutId = null;
  }, 1800);
};

const render = (): void => {
  const isUnlockedList =
    state.route === "UNLOCKED" && state.screen === "LIST" && !state.showDeleteConfirm && state.entries.length > 0;
  const popupModeClass = isUnlockedList ? "popup popup--unlocked" : "popup popup--auth";
  const cardClass = isUnlockedList ? "card card--entries" : "card";

  root.innerHTML = `
    <main class="${popupModeClass}">
      ${state.toastMessage ? `<div class="toast ${state.toastTone}">${escapeHtml(state.toastMessage)}</div>` : ""}

      <div class="topline">
        <pre class="ascii-art" tabindex="-1" aria-hidden="true">${escapeHtml(ASCII_ART)}</pre>
        <header class="row">
          <span class="chip">${routeLabels[state.route]}</span>
        </header>
      </div>

      <section class="${cardClass}">
        ${renderRouteBody(state, { escapeHtml, maskPassword, getSelectedEntry: () => readSelectedEntry(state) })}
      </section>
    </main>
  `;

  focusUnlockInput();
};

const refreshEntries = (): Promise<boolean> => {
  return loadEntries(state, { render, setToast });
};

const refreshStatus = (): Promise<void> => {
  return loadStatus(state, { render, setToast });
};

const ensureSelectedSecret = () => {
  return loadSelectedSecret(state, { render, setToast });
};

const saveRecoveryCodesContext = () => {
  return saveRecoveryCodes(state);
};

attachPopupSubmitHandler({
  root,
  state,
  render,
  setToast,
  sendApiMessage,
  refreshStatus,
  refreshEntries,
  ensureSelectedSecret,
  saveRecoveryCodesContext,
  consumeSignupUnlockContext,
  getSelectedEntry: () => readSelectedEntry(state),
  selectEntry: (entryId) => setSelectedEntry(state, entryId),
  copyText,
  recoveryCodesKey: RECOVERY_CODES_KEY,
});

root.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }

  const unlockForm = target.closest('form[data-action="unlock-vault"]');
  if (unlockForm && target.name === "master") {
    state.unlockMasterDraft = target.value;
    if (state.toastTone === "error" && state.toastMessage) {
      state.toastMessage = "";
      state.toastTone = "info";
      if (toastTimeoutId) {
        clearTimeout(toastTimeoutId);
        toastTimeoutId = null;
      }
      const toastNode = root.querySelector(".toast");
      if (toastNode) {
        toastNode.remove();
      }
    }
    return;
  }

  if (target.dataset.action !== "search") {
    return;
  }

  state.search = target.value;
  render();
});

attachPopupClickHandler({
  root,
  state,
  render,
  setToast,
  sendApiMessage,
  refreshStatus,
  refreshEntries,
  ensureSelectedSecret,
  saveRecoveryCodesContext,
  consumeSignupUnlockContext,
  getSelectedEntry: () => readSelectedEntry(state),
  selectEntry: (entryId) => setSelectedEntry(state, entryId),
  copyText,
  recoveryCodesKey: RECOVERY_CODES_KEY,
});

void restoreRecoveryCodes(state).then(() => {
  render();
  void refreshStatus();
});
