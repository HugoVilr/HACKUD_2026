import type { HandlerDeps } from "./types.ts";

export const handleCreateVaultSubmit = async (data: FormData, deps: HandlerDeps): Promise<void> => {
  const vaultName = String(data.get("vaultName") ?? "").trim();
  const master = String(data.get("master") ?? "");
  const confirm = String(data.get("confirm") ?? "");

  if (!master || !confirm) {
    deps.setToast("Completa ambos campos de master password.", "error");
    return;
  }
  if (master.length < 8) {
    deps.setToast("La master password debe tener al menos 8 caracteres.", "error");
    return;
  }
  if (master !== confirm) {
    deps.setToast("Las contrasenas no coinciden.", "error");
    return;
  }

  try {
    const res = await deps.sendApiMessage("VAULT_CREATE", {
      masterPassword: master,
      confirmPassword: confirm,
      vaultName: vaultName || undefined,
    });

    if (!res.ok) {
      deps.setToast(res.error?.message || "No se pudo crear el vault.", "error");
      return;
    }

    if (res.data?.recoveryCodes && res.data.recoveryCodes.length > 0) {
      deps.state.recoveryCodes = res.data.recoveryCodes;
      deps.state.recoveryCodesAcknowledged = false;
      deps.state.recoveryCodesSaved = false;
      await deps.saveRecoveryCodesContext();
      deps.render();
      return;
    }

    await deps.refreshStatus();
    deps.setToast("Vault creado.", "success");
  } catch {
    deps.setToast("Error al crear el vault.", "error");
  }
};

export const handleUnlockVaultSubmit = async (data: FormData, deps: HandlerDeps): Promise<void> => {
  const master = String(data.get("master") ?? deps.state.unlockMasterDraft ?? "");
  if (!master) {
    deps.setToast("Introduce tu master password.", "error");
    return;
  }
  deps.state.unlockMasterDraft = master;

  try {
    const res = await deps.sendApiMessage("VAULT_UNLOCK", {
      masterPassword: master,
    });

    if (!res.ok) {
      deps.state.unlockMasterDraft = "";
      deps.setToast("Master incorrecta.", "error");
      return;
    }

    deps.state.unlockMasterDraft = "";
    const shouldClosePopup = await deps.consumeSignupUnlockContext();
    if (shouldClosePopup) {
      setTimeout(() => {
        window.close();
      }, 80);
    }

    try {
      await deps.refreshStatus();
    } catch {
      // Ignore: no bloquear el cierre del popup.
    }
    deps.setToast("Vault desbloqueado.", "success");
  } catch {
    deps.state.unlockMasterDraft = "";
    deps.setToast("No se pudo desbloquear el vault.", "error");
  }
};

export const handleUnlockRecoverySubmit = async (data: FormData, deps: HandlerDeps): Promise<void> => {
  const recoveryCode = String(data.get("recoveryCode") ?? "").trim();
  if (!recoveryCode) {
    deps.setToast("Introduce tu recovery code.", "error");
    return;
  }

  try {
    const res = await deps.sendApiMessage("VAULT_UNLOCK_RECOVERY", {
      recoveryCode,
    });

    if (!res.ok) {
      if (res.error?.code === "RECOVERY_CODE_USED") {
        deps.setToast("Este recovery code ya fue utilizado.", "error");
      } else {
        deps.setToast("Recovery code inválido.", "error");
      }
      return;
    }

    deps.state.showRecoveryCodeUnlock = false;
    await deps.refreshStatus();

    deps.setToast("Vault desbloqueado con recovery code. ⚠️ CAMBIA TU CONTRASEÑA MAESTRA inmediatamente.", "success");
  } catch {
    deps.setToast("No se pudo desbloquear el vault.", "error");
  }
};

export const handleConfirmDeleteVaultSubmit = async (data: FormData, deps: HandlerDeps): Promise<void> => {
  const master = String(data.get("master") ?? "");
  const confirmText = String(data.get("confirmText") ?? "").trim();

  if (!master || !confirmText) {
    deps.setToast("Completa todos los campos.", "error");
    return;
  }

  if (confirmText.toLowerCase() !== "eliminar") {
    deps.setToast("Debes escribir 'eliminar' exactamente para confirmar.", "error");
    return;
  }

  try {
    const res = await deps.sendApiMessage("VAULT_DELETE", {
      masterPassword: master,
      confirmText,
    });

    if (!res.ok) {
      deps.setToast(res.error?.message || "No se pudo eliminar el vault.", "error");
      return;
    }

    deps.state.recoveryCodes = null;
    deps.state.recoveryCodesAcknowledged = false;
    deps.state.recoveryCodesSaved = false;
    await chrome.storage.session.remove(deps.recoveryCodesKey);

    deps.state.showDeleteConfirm = false;
    await deps.refreshStatus();
    deps.setToast("Vault eliminado correctamente.", "success");
  } catch {
    deps.setToast("Error al eliminar el vault.", "error");
  }
};

export const handleVaultActionClick = async (action: string, deps: HandlerDeps): Promise<boolean> => {
  if (action === "lock") {
    try {
      const res = await deps.sendApiMessage("VAULT_LOCK");
      if (!res.ok) {
        deps.setToast(res.error?.message || "No se pudo bloquear el vault.", "error");
        return true;
      }
      await deps.refreshStatus();
      deps.setToast("Vault bloqueado.", "info");
    } catch {
      deps.setToast("No se pudo bloquear el vault.", "error");
    }
    return true;
  }

  if (action === "run-hibp-audit") {
    try {
      const res = await deps.sendApiMessage("HIBP_AUDIT_START");
      if (!res.ok) {
        deps.setToast(res.error?.message || "No se pudo iniciar la auditoria HIBP.", "error");
        return true;
      }

      const auditId = String(res.data?.auditId ?? "").trim();
      if (!auditId) {
        deps.setToast("No se pudo crear el reporte de auditoria.", "error");
        return true;
      }

      const url = chrome.runtime.getURL(`src/report/report.html?audit=${encodeURIComponent(auditId)}`);
      await chrome.tabs.create({ url });
      deps.setToast("Auditoria iniciada. Reporte abierto en una nueva pestana.", "info");
    } catch {
      deps.setToast("No se pudo iniciar la auditoria HIBP.", "error");
    }
    return true;
  }

  if (action === "show-delete") {
    const confirmed = window.confirm(
      "⚠️ ADVERTENCIA: Esta acción eliminará PERMANENTEMENTE todas tus contraseñas.\n\n" +
        "¿Estás seguro de que quieres continuar?",
    );
    if (!confirmed) {
      return true;
    }
    deps.state.showDeleteConfirm = true;
    deps.render();
    return true;
  }

  if (action === "cancel-delete") {
    deps.state.showDeleteConfirm = false;
    deps.render();
    return true;
  }

  if (action === "show-recovery") {
    deps.state.showRecoveryCodeUnlock = true;
    deps.render();
    return true;
  }

  if (action === "cancel-recovery") {
    deps.state.showRecoveryCodeUnlock = false;
    deps.render();
    return true;
  }

  if (action === "toggle-recovery-ack") {
    deps.state.recoveryCodesAcknowledged = !deps.state.recoveryCodesAcknowledged;
    await deps.saveRecoveryCodesContext();
    deps.render();
    return true;
  }

  if (action === "copy-recovery-codes") {
    if (!deps.state.recoveryCodes) return true;
    const text = deps.state.recoveryCodes.map((code, i) => `${i + 1}. ${code}`).join("\n");
    try {
      await deps.copyText(text);
      deps.state.recoveryCodesSaved = true;
      await deps.saveRecoveryCodesContext();
      deps.setToast("Códigos copiados al portapapeles", "success");
    } catch {
      deps.setToast("No se pudo copiar", "error");
    }
    return true;
  }

  if (action === "export-recovery-codes") {
    if (!deps.state.recoveryCodes) return true;
    try {
      const res = await deps.sendApiMessage("EXPORT_RECOVERY_CODES", {
        codes: deps.state.recoveryCodes,
        vaultName: deps.state.vaultName || undefined,
      });
      if (!res.ok) {
        deps.setToast("Error al exportar", "error");
        return true;
      }

      const blob = new Blob([res.data.blob], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = res.data.filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      deps.state.recoveryCodesSaved = true;
      await deps.saveRecoveryCodesContext();
      deps.setToast("Códigos exportados", "success");
    } catch {
      deps.setToast("Error al exportar", "error");
    }
    return true;
  }

  if (action === "done-recovery-codes") {
    if (!deps.state.recoveryCodesSaved || !deps.state.recoveryCodesAcknowledged) return true;
    deps.state.recoveryCodes = null;
    deps.state.recoveryCodesAcknowledged = false;
    deps.state.recoveryCodesSaved = false;
    await chrome.storage.session.remove(deps.recoveryCodesKey);
    await deps.refreshStatus();
    deps.setToast("Vault creado exitosamente", "success");
    return true;
  }

  return false;
};
