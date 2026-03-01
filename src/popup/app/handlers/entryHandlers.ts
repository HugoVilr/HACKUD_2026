import type { HandlerDeps } from "./types.ts";

export const handleSaveEntrySubmit = async (form: HTMLFormElement, data: FormData, deps: HandlerDeps): Promise<void> => {
  const title = String(data.get("title") ?? "").trim();
  const domain = String(data.get("domain") ?? "").trim();
  const username = String(data.get("username") ?? "").trim();
  const password = String(data.get("password") ?? "").trim();
  const notes = String(data.get("notes") ?? "").trim();

  if (!title || !password) {
    deps.setToast("Titulo y password son obligatorios.", "error");
    return;
  }

  const mode = form.dataset.mode;

  try {
    if (mode === "edit" && deps.state.selectedEntryId) {
      const selected = deps.getSelectedEntry();
      if (!selected) {
        deps.setToast("No se encontro la entrada.", "error");
        return;
      }

      const res = await deps.sendApiMessage("ENTRY_UPDATE", {
        entry: {
          id: deps.state.selectedEntryId,
          title,
          domain: domain || undefined,
          username: username || undefined,
          password,
          notes: notes || undefined,
          createdAt: selected.createdAt,
          updatedAt: selected.updatedAt,
        },
      });

      if (!res.ok) {
        deps.setToast(res.error?.message || "No se pudo actualizar la entry.", "error");
        return;
      }

      deps.state.selectedSecret = {
        id: deps.state.selectedEntryId,
        username,
        password,
      };
      deps.state.screen = "DETAIL";
      deps.state.detailPasswordVisible = false;
      await deps.refreshEntries();
      deps.setToast("Entry actualizada.", "success");
      return;
    }

    const res = await deps.sendApiMessage("ENTRY_ADD", {
      entry: {
        title,
        domain: domain || undefined,
        username: username || undefined,
        password,
        notes: notes || undefined,
      },
    });

    if (!res.ok) {
      deps.setToast(res.error?.message || "No se pudo crear la entry.", "error");
      return;
    }

    const newId = res.data?.entry?.id;
    await deps.refreshEntries();
    if (newId) {
      deps.selectEntry(newId);
      deps.state.selectedSecret = {
        id: newId,
        username,
        password,
      };
    }

    deps.setToast("Entry creada.", "success");

    try {
      await deps.sendApiMessage("REQUEST_AUTOFILL", {
        username: username || "",
        password,
      });
    } catch (e) {
      console.debug("[G8keeper] Autofill not available:", e);
    }

    deps.render();
  } catch {
    deps.setToast("No se pudo guardar la entry.", "error");
  }
};

export const handleEntryActionClick = async (
  action: string,
  actionButton: Element | null,
  deps: HandlerDeps,
): Promise<boolean> => {
  if (action === "to-add") {
    deps.state.formPasswordVisible = false;
    deps.state.selectedSecret = null;
    deps.state.screen = "FORM_ADD";
    deps.render();
    return true;
  }

  if (action === "to-list") {
    deps.state.detailPasswordVisible = false;
    deps.state.formPasswordVisible = false;
    deps.state.showDeleteConfirm = false;
    deps.state.screen = "LIST";
    deps.render();
    return true;
  }

  if (action === "to-edit") {
    deps.state.formPasswordVisible = false;
    await deps.ensureSelectedSecret();
    deps.state.screen = "FORM_EDIT";
    deps.render();
    return true;
  }

  if (action === "delete-entry") {
    const entry = deps.getSelectedEntry();
    if (!entry) {
      deps.setToast("No se encontro la entrada.", "error");
      return true;
    }

    const confirmed = window.confirm(
      "⚠️ ADVERTENCIA: Esta acción eliminará PERMANENTEMENTE esta credencial.\n\n" +
        "¿Estás seguro de que quieres continuar?",
    );
    if (!confirmed) {
      return true;
    }

    try {
      const res = await deps.sendApiMessage("ENTRY_DELETE", { id: entry.id });
      if (!res.ok) {
        deps.setToast(res.error?.message || "No se pudo eliminar la entry.", "error");
        return true;
      }
      deps.state.selectedEntryId = null;
      deps.state.selectedSecret = null;
      deps.state.detailPasswordVisible = false;
      deps.state.screen = "LIST";
      await deps.refreshEntries();
      deps.setToast("Entry eliminada.", "success");
    } catch {
      deps.setToast("No se pudo eliminar la entry.", "error");
    }
    return true;
  }

  if (action === "open-entry") {
    const entryId = actionButton?.getAttribute("data-entry-id") ?? "";
    if (!entryId) {
      return true;
    }
    deps.selectEntry(entryId);
    deps.render();
    await deps.ensureSelectedSecret();
    return true;
  }

  if (action === "toggle-form-password") {
    if (!deps.state.formPasswordVisible) {
      const accepted = window.confirm("Vas a revelar la contrasena en pantalla. Continuar?");
      if (!accepted) {
        return true;
      }
    }
    deps.state.formPasswordVisible = !deps.state.formPasswordVisible;
    deps.render();
    return true;
  }

  if (action === "toggle-detail-password") {
    if (!deps.state.detailPasswordVisible) {
      const accepted = window.confirm("Vas a revelar la contrasena en pantalla. Continuar?");
      if (!accepted) {
        return true;
      }
      const secret = await deps.ensureSelectedSecret();
      if (!secret) {
        return true;
      }
    }

    deps.state.detailPasswordVisible = !deps.state.detailPasswordVisible;
    deps.render();
    return true;
  }

  if (action === "copy-username" || action === "copy-password") {
    const entry = deps.getSelectedEntry();
    if (!entry) {
      deps.setToast("No se encontro la entrada.", "error");
      return true;
    }

    const secret = await deps.ensureSelectedSecret();
    const value = action === "copy-username" ? secret?.username || entry.username : secret?.password;

    if (!value) {
      deps.setToast("No hay valor para copiar.", "error");
      return true;
    }

    try {
      await deps.copyText(value);
      deps.setToast(action === "copy-password" ? "Password copiada." : "Usuario copiado.", "success");
    } catch {
      deps.setToast("No se pudo copiar al portapapeles.", "error");
    }
    return true;
  }

  return false;
};
