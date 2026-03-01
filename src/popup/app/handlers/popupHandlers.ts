import { handleEntryActionClick, handleSaveEntrySubmit } from "./entryHandlers.ts";
import {
  handleConfirmDeleteVaultSubmit,
  handleCreateVaultSubmit,
  handleUnlockRecoverySubmit,
  handleUnlockVaultSubmit,
  handleVaultActionClick,
} from "./vaultHandlers.ts";
import type { HandlerDeps } from "./types.ts";

export type { HandlerDeps } from "./types.ts";
export { handleUnlockVaultSubmit } from "./vaultHandlers.ts";

export const handlePopupActionClick = async (
  action: string,
  actionButton: Element | null,
  deps: HandlerDeps,
): Promise<void> => {
  const handledByVault = await handleVaultActionClick(action, deps);
  if (handledByVault) {
    return;
  }

  await handleEntryActionClick(action, actionButton, deps);
};

export const attachPopupSubmitHandler = (deps: HandlerDeps): void => {
  deps.root.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) {
      return;
    }

    const action = form.dataset.action;
    if (!action) {
      return;
    }

    event.preventDefault();
    const data = new FormData(form);

    if (action === "create-vault") {
      await handleCreateVaultSubmit(data, deps);
      return;
    }

    if (action === "unlock-vault") {
      await handleUnlockVaultSubmit(data, deps);
      return;
    }

    if (action === "unlock-recovery") {
      await handleUnlockRecoverySubmit(data, deps);
      return;
    }

    if (action === "save-entry") {
      await handleSaveEntrySubmit(form, data, deps);
      return;
    }

    if (action === "confirm-delete") {
      await handleConfirmDeleteVaultSubmit(data, deps);
    }
  });
};

export const attachPopupClickHandler = (deps: HandlerDeps): void => {
  deps.root.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const actionButton = target.closest("[data-action]");
    if (actionButton instanceof HTMLFormElement) {
      return;
    }

    const action = actionButton?.getAttribute("data-action");
    if (!action) {
      return;
    }

    await handlePopupActionClick(action, actionButton, deps);
  });
};
