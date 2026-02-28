const state = {
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
  showDeleteConfirm: false
};

const root = document.getElementById("app");
if (!root) {
  throw new Error("Popup root not found");
}

const routeLabels = {
  NO_VAULT: "No Vault",
  LOCKED: "Locked",
  UNLOCKED: "Unlocked"
};

const ASCII_ART = String.raw`
                                               
 (        (          )                         
 )\ )     )\ (    ( /(   (   (         (  (    
(()/(    ((_))\   )\()) ))\ ))\`  )   ))\ )(   
 /(_))_    _((_) ((_)\ /((_)((_)(/(  /((_|()\  
(_)) __|  ( _ )  | |(_|_))(_))((_)_\(_))  ((_) 
  | (_ |  / _ \  | / // -_) -_) '_ \) -_)| '_| 
   \___|  \___/  |_\_\\___\___| .__/\___||_|   
                              |_|              
`;

let toastTimeoutId = null;

const escapeHtml = (value) => {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
};

const setToast = (message, tone = "info") => {
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

const focusUnlockInput = () => {
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

const copyText = async (value) => {
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

const maskPassword = (value) => {
  if (!value) {
    return "-";
  }
  return "*".repeat(Math.max(8, value.length));
};

const setRoute = (route) => {
  state.route = route;
  state.formPasswordVisible = false;
  state.detailPasswordVisible = false;
  state.selectedSecret = null;
  state.search = "";
  state.screen = "LIST";
  state.selectedEntryId = null;
};

const selectEntry = (entryId) => {
  state.selectedEntryId = entryId;
  state.detailPasswordVisible = false;
  state.selectedSecret = null;
  state.screen = "DETAIL";
};

const getSelectedEntry = () => {
  return state.entries.find((entry) => entry.id === state.selectedEntryId) ?? null;
};

const sendApiMessage = async (type, payload) => {
  const message = payload === undefined ? { type } : { type, payload };
  const res = await chrome.runtime.sendMessage(message);
  if (!res || typeof res.ok !== "boolean") {
    throw new Error("api-bad-response");
  }
  return res;
};

const refreshEntries = async () => {
  const res = await sendApiMessage("ENTRY_LIST");
  if (!res.ok) {
    state.entries = [];
    render();
    setToast(res.error?.message || "No se pudieron cargar las entries.", "error");
    return false;
  }

  state.entries = Array.isArray(res.data?.entries) ? res.data.entries : [];
  render();
  return true;
};

const refreshStatus = async () => {
  const res = await sendApiMessage("VAULT_STATUS");
  if (!res.ok) {
    render();
    setToast(res.error?.message || "No se pudo obtener el estado del vault.", "error");
    return;
  }

  state.vaultName = res.data?.vaultName || "";

  if (!res.data?.hasVault) {
    setRoute("NO_VAULT");
    state.entries = [];
    render();
    return;
  }

  if (res.data?.locked) {
    setRoute("LOCKED");
    state.entries = [];
    render();
    return;
  }

  setRoute("UNLOCKED");
  await refreshEntries();
};

const ensureSelectedSecret = async () => {
  const id = state.selectedEntryId;
  if (!id) {
    return null;
  }

  if (state.selectedSecret?.id === id) {
    return state.selectedSecret;
  }

  const res = await sendApiMessage("ENTRY_GET_SECRET", { id });
  if (!res.ok) {
    setToast(res.error?.message || "No se pudo obtener el secreto.", "error");
    return null;
  }

  state.selectedSecret = res.data?.secret ?? null;
  render();
  return state.selectedSecret;
};

const renderCreateVault = () => {
  return `
    <h1>Create vault</h1>
    <p class="muted">Crea una master password para tu vault local.</p>
    <form data-action="create-vault" class="stack">
      <label class="field">
        <span>Nombre (opcional)</span>
        <input name="vaultName" type="text" placeholder="Mi Vault" maxlength="40" />
      </label>
      <label class="field">
        <span>Master password</span>
        <input name="master" type="password" required minlength="8" />
      </label>
      <label class="field">
        <span>Confirmar master</span>
        <input name="confirm" type="password" required minlength="8" />
      </label>
      <button class="primary" type="submit">Crear vault</button>
    </form>
  `;
};

const renderUnlock = () => {
  const vaultHint = state.vaultName
    ? `Vault: ${escapeHtml(state.vaultName)}`
    : "Vault local detectado. Introduce tu master password.";

  return `
    <h1>Unlock vault</h1>
    <p class="muted">${vaultHint}</p>
    <form data-action="unlock-vault" class="stack">
      <label class="field">
        <span>Master password</span>
        <input name="master" type="password" required value="${escapeHtml(state.unlockMasterDraft)}" />
      </label>
      <button class="primary" type="submit">Desbloquear</button>
    </form>
  `;
};

const renderList = () => {
  // Si está mostrando el formulario de confirmación de eliminación
  if (state.showDeleteConfirm) {
    return `
      <div class="entries-screen">
        <div class="toolbar">
          <h1>⚠️ Eliminar Vault</h1>
          <button type="button" data-action="cancel-delete" class="primary">Cancelar</button>
        </div>

        <div class="stack">
          <p class="muted warning-text">
            ⚠️ ADVERTENCIA: Esta acción es IRREVERSIBLE. Se eliminarán todas tus contraseñas guardadas.
          </p>
          
          <form data-action="confirm-delete" class="stack">
            <label class="field">
              <span>Master password</span>
              <input name="master" type="password" required />
            </label>
            
            <label class="field">
              <span>Escribe "eliminar" para confirmar</span>
              <input name="confirmText" type="text" required placeholder="eliminar" />
            </label>
            
            <button class="danger-button" type="submit">
              Eliminar Vault Permanentemente
            </button>
          </form>
        </div>
      </div>
    `;
  }

  const needle = state.search.trim().toLowerCase();
  const visibleEntries = state.entries.filter((entry) => {
    if (!needle) {
      return true;
    }
    return (
      String(entry.title || "").toLowerCase().includes(needle) ||
      String(entry.username || "").toLowerCase().includes(needle) ||
      String(entry.notes || "").toLowerCase().includes(needle)
    );
  });

  return `
    <div class="entries-screen">
      <div class="toolbar">
        <h1>Vault entries</h1>
        <div class="toolbar-actions">
          <button type="button" data-action="to-add" class="primary">+ Add</button>
          <button type="button" data-action="lock">Lock</button>
          <button type="button" data-action="show-delete" class="caution-button">Eliminar Vault</button>
        </div>
      </div>

      <label class="field">
        <span>Buscar</span>
        <input
          data-action="search"
          type="search"
          value="${escapeHtml(state.search)}"
          placeholder="Titulo, user o nota"
        />
      </label>

      <ul class="entry-list">
        ${
          visibleEntries.length === 0
            ? '<li class="entry-empty">No hay resultados para la busqueda.</li>'
            : visibleEntries
                .map((entry) => {
                  return `
                    <li>
                      <button type="button" data-action="open-entry" data-entry-id="${entry.id}" class="entry-item">
                        <strong>${escapeHtml(entry.title || "")}</strong>
                        <span>${escapeHtml(entry.username || "sin usuario")}</span>
                      </button>
                    </li>
                  `;
                })
                .join("")
        }
      </ul>
    </div>
  `;
};

const renderEntryForm = (mode) => {
  const entry = mode === "edit" ? getSelectedEntry() : null;
  const title = entry?.title ?? "";
  const username = entry?.username ?? "";
  const password = mode === "edit" ? state.selectedSecret?.password ?? "" : "";
  const notes = entry?.notes ?? "";

  return `
    <div class="toolbar">
      <h1>${mode === "edit" ? "Edit entry" : "Add entry"}</h1>
      <button type="button" data-action="to-list">Cancelar</button>
    </div>

    <form data-action="save-entry" data-mode="${mode}" class="stack">
      <label class="field">
        <span>Titulo</span>
        <input name="title" type="text" required maxlength="60" value="${escapeHtml(title)}" />
      </label>
      <label class="field">
        <span>Usuario</span>
        <input name="username" type="text" maxlength="80" value="${escapeHtml(username)}" />
      </label>
      <label class="field">
        <span>Password</span>
        <div class="inline-row">
          <input
            name="password"
            type="${state.formPasswordVisible ? "text" : "password"}"
            required
            maxlength="100"
            value="${escapeHtml(password)}"
          />
          <button type="button" data-action="toggle-form-password">
            ${state.formPasswordVisible ? "Ocultar" : "Revelar"}
          </button>
        </div>
      </label>
      <label class="field">
        <span>Notas</span>
        <textarea name="notes" rows="3" maxlength="280">${escapeHtml(notes)}</textarea>
      </label>
      <button class="primary" type="submit">Guardar</button>
    </form>
  `;
};

const renderEntryDetail = () => {
  const entry = getSelectedEntry();
  if (!entry) {
    state.screen = "LIST";
    return renderList();
  }

  const password = state.selectedSecret?.id === entry.id ? state.selectedSecret.password : "";

  return `
    <div class="toolbar">
      <h1>Entry detail</h1>
      <div class="toolbar-actions">
        <button type="button" data-action="to-list">Volver</button>
        <button type="button" data-action="to-edit" class="primary">Editar</button>
      </div>
    </div>

    <dl class="detail-grid">
      <dt>Titulo</dt>
      <dd>${escapeHtml(entry.title || "")}</dd>

      <dt>Usuario</dt>
      <dd>
        <div class="inline-row">
          <span>${escapeHtml(entry.username || "-")}</span>
          <button type="button" data-action="copy-username">Copiar</button>
        </div>
      </dd>

      <dt>Password</dt>
      <dd>
        <div class="inline-row">
          <code class="secret">${escapeHtml(state.detailPasswordVisible ? password || "-" : maskPassword(password || ""))}</code>
          <button type="button" data-action="toggle-detail-password">
            ${state.detailPasswordVisible ? "Ocultar" : "Revelar"}
          </button>
          <button type="button" data-action="copy-password">Copiar</button>
        </div>
      </dd>

      <dt>Notas</dt>
      <dd>${escapeHtml(entry.notes || "-")}</dd>
    </dl>
  `;
};

const renderUnlocked = () => {
  switch (state.screen) {
    case "FORM_ADD":
      return renderEntryForm("add");
    case "FORM_EDIT":
      return renderEntryForm("edit");
    case "DETAIL":
      return renderEntryDetail();
    default:
      return renderList();
  }
};

const routeBody = () => {
  switch (state.route) {
    case "NO_VAULT":
      return renderCreateVault();
    case "LOCKED":
      return renderUnlock();
    case "UNLOCKED":
      return renderUnlocked();
    default:
      return "";
  }
};

const render = () => {
  const isUnlockedList =
    state.route === "UNLOCKED" &&
    state.screen === "LIST" &&
    !state.showDeleteConfirm &&
    state.entries.length > 0;
  const popupModeClass = isUnlockedList ? "popup popup--unlocked" : "popup popup--auth";
  const cardClass = isUnlockedList ? "card card--entries" : "card";

  root.innerHTML = `
    <main class="${popupModeClass}">
      ${state.toastMessage ? `<div class="toast ${state.toastTone}">${escapeHtml(state.toastMessage)}</div>` : ""}

      <div class="topline">
        <pre class="ascii-art" aria-hidden="true">${escapeHtml(ASCII_ART)}</pre>
        <header class="row">
          <span class="chip">${routeLabels[state.route]}</span>
        </header>
      </div>

      <section class="${cardClass}">
        ${routeBody()}
      </section>
    </main>
  `;
  focusUnlockInput();
};

root.addEventListener("submit", async (event) => {
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
    const vaultName = String(data.get("vaultName") ?? "").trim();
    const master = String(data.get("master") ?? "");
    const confirm = String(data.get("confirm") ?? "");

    if (!master || !confirm) {
      setToast("Completa ambos campos de master password.", "error");
      return;
    }
    if (master.length < 8) {
      setToast("La master password debe tener al menos 8 caracteres.", "error");
      return;
    }
    if (master !== confirm) {
      setToast("Las contrasenas no coinciden.", "error");
      return;
    }

    try {
      const res = await sendApiMessage("VAULT_CREATE", {
        masterPassword: master,
        confirmPassword: confirm,
        vaultName: vaultName || undefined
      });

      if (!res.ok) {
        setToast(res.error?.message || "No se pudo crear el vault.", "error");
        return;
      }

      await refreshStatus();
      setToast("Vault creado. Ahora desbloquealo.", "success");
    } catch (_error) {
      setToast("Error al crear el vault.", "error");
    }

    return;
  }

  if (action === "unlock-vault") {
    const master = String(data.get("master") ?? state.unlockMasterDraft ?? "");
    if (!master) {
      setToast("Introduce tu master password.", "error");
      return;
    }
    state.unlockMasterDraft = master;

    try {
      const res = await sendApiMessage("VAULT_UNLOCK", {
        masterPassword: master
      });

      if (!res.ok) {
        state.unlockMasterDraft = "";
        setToast("Master incorrecta.", "error");
        return;
      }

      state.unlockMasterDraft = "";
      await refreshStatus();
      setToast("Vault desbloqueado.", "success");
    } catch (_error) {
      state.unlockMasterDraft = "";
      setToast("No se pudo desbloquear el vault.", "error");
    }

    return;
  }

  if (action === "save-entry") {
    const title = String(data.get("title") ?? "").trim();
    const username = String(data.get("username") ?? "").trim();
    const password = String(data.get("password") ?? "").trim();
    const notes = String(data.get("notes") ?? "").trim();

    if (!title || !password) {
      setToast("Titulo y password son obligatorios.", "error");
      return;
    }

    const mode = form.dataset.mode;

    try {
      if (mode === "edit" && state.selectedEntryId) {
        const selected = getSelectedEntry();
        if (!selected) {
          setToast("No se encontro la entrada.", "error");
          return;
        }

        const res = await sendApiMessage("ENTRY_UPDATE", {
          entry: {
            id: state.selectedEntryId,
            title,
            username: username || undefined,
            password,
            notes: notes || undefined,
            createdAt: selected.createdAt,
            updatedAt: selected.updatedAt
          }
        });

        if (!res.ok) {
          setToast(res.error?.message || "No se pudo actualizar la entry.", "error");
          return;
        }

        state.selectedSecret = {
          id: state.selectedEntryId,
          username,
          password
        };
        state.screen = "DETAIL";
        state.detailPasswordVisible = false;
        await refreshEntries();
        setToast("Entry actualizada.", "success");
        return;
      }

      const res = await sendApiMessage("ENTRY_ADD", {
        entry: {
          title,
          username: username || undefined,
          password,
          notes: notes || undefined
        }
      });

      if (!res.ok) {
        setToast(res.error?.message || "No se pudo crear la entry.", "error");
        return;
      }

      const newId = res.data?.entry?.id;
      await refreshEntries();
      if (newId) {
        selectEntry(newId);
        state.selectedSecret = {
          id: newId,
          username,
          password
        };
      }

      setToast("Entry creada.", "success");
      
      // Intentar autofill en la pestaña activa si hay un formulario
      try {
        await sendApiMessage("REQUEST_AUTOFILL", {
          username: username || "",
          password
        });
      } catch (e) {
        // Silenciar error si no hay content script o formulario
        console.debug('[G8keeper] Autofill not available:', e);
      }
      
      render();
    } catch (_error) {
      setToast("No se pudo guardar la entry.", "error");
    }
    return;
  }

  if (action === "confirm-delete") {
    const master = String(data.get("master") ?? "");
    const confirmText = String(data.get("confirmText") ?? "").trim();

    if (!master || !confirmText) {
      setToast("Completa todos los campos.", "error");
      return;
    }

    if (confirmText.toLowerCase() !== "eliminar") {
      setToast("Debes escribir 'eliminar' exactamente para confirmar.", "error");
      return;
    }

    try {
      const res = await sendApiMessage("VAULT_DELETE", {
        masterPassword: master,
        confirmText: confirmText
      });

      if (!res.ok) {
        setToast(res.error?.message || "No se pudo eliminar el vault.", "error");
        return;
      }

      state.showDeleteConfirm = false;
      await refreshStatus();
      setToast("Vault eliminado correctamente.", "success");
    } catch (_error) {
      setToast("Error al eliminar el vault.", "error");
    }
  }
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

root.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const actionButton = target.closest("[data-action]");
  if (actionButton instanceof HTMLFormElement) {
    return;
  }
  const action = actionButton?.dataset.action;
  if (!action) {
    return;
  }

  if (action === "lock") {
    try {
      const res = await sendApiMessage("VAULT_LOCK");
      if (!res.ok) {
        setToast(res.error?.message || "No se pudo bloquear el vault.", "error");
        return;
      }
      await refreshStatus();
      setToast("Vault bloqueado.", "info");
    } catch (_error) {
      setToast("No se pudo bloquear el vault.", "error");
    }
    return;
  }

  if (action === "to-add") {
    state.formPasswordVisible = false;
    state.selectedSecret = null;
    state.screen = "FORM_ADD";
    render();
    return;
  }

  if (action === "to-list") {
    state.detailPasswordVisible = false;
    state.formPasswordVisible = false;
    state.showDeleteConfirm = false;
    state.screen = "LIST";
    render();
    return;
  }

  if (action === "show-delete") {
    const confirmed = window.confirm(
      "⚠️ ADVERTENCIA: Esta acción eliminará PERMANENTEMENTE todas tus contraseñas.\n\n" +
      "¿Estás seguro de que quieres continuar?"
    );
    if (!confirmed) {
      return;
    }
    state.showDeleteConfirm = true;
    render();
    return;
  }

  if (action === "cancel-delete") {
    state.showDeleteConfirm = false;
    render();
    return;
  }

  if (action === "to-edit") {
    state.formPasswordVisible = false;
    await ensureSelectedSecret();
    state.screen = "FORM_EDIT";
    render();
    return;
  }

  if (action === "open-entry") {
    const entryId = actionButton?.dataset.entryId;
    if (!entryId) {
      return;
    }
    selectEntry(entryId);
    render();
    await ensureSelectedSecret();
    return;
  }

  if (action === "toggle-form-password") {
    if (!state.formPasswordVisible) {
      const accepted = window.confirm("Vas a revelar la contrasena en pantalla. Continuar?");
      if (!accepted) {
        return;
      }
    }
    state.formPasswordVisible = !state.formPasswordVisible;
    render();
    return;
  }

  if (action === "toggle-detail-password") {
    if (!state.detailPasswordVisible) {
      const accepted = window.confirm("Vas a revelar la contrasena en pantalla. Continuar?");
      if (!accepted) {
        return;
      }
      const secret = await ensureSelectedSecret();
      if (!secret) {
        return;
      }
    }

    state.detailPasswordVisible = !state.detailPasswordVisible;
    render();
    return;
  }

  if (action === "copy-username" || action === "copy-password") {
    const entry = getSelectedEntry();
    if (!entry) {
      setToast("No se encontro la entrada.", "error");
      return;
    }

    const secret = await ensureSelectedSecret();
    const value = action === "copy-username"
      ? secret?.username || entry.username
      : secret?.password;

    if (!value) {
      setToast("No hay valor para copiar.", "error");
      return;
    }

    try {
      await copyText(value);
      setToast(action === "copy-password" ? "Password copiada." : "Usuario copiado.", "success");
    } catch (_error) {
      setToast("No se pudo copiar al portapapeles.", "error");
    }
  }
});

render();
void refreshStatus();
