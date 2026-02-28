const state = {
  route: "NO_VAULT",
  screen: "LIST",
  vaultName: "",
  createError: "",
  unlockError: "",
  search: "",
  selectedEntryId: null,
  formError: "",
  formPasswordVisible: false,
  detailPasswordVisible: false,
  selectedSecret: null,
  toastMessage: "",
  toastTone: "info",
  entries: []
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

let toastTimeoutId = null;

const isPopupRoute = (value) => {
  return value === "NO_VAULT" || value === "LOCKED" || value === "UNLOCKED";
};

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
  state.createError = "";
  state.unlockError = "";
  state.formError = "";
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
    setToast(res.error?.message || "No se pudieron cargar las entries.", "error");
    state.entries = [];
    render();
    return;
  }
  state.entries = Array.isArray(res.data?.entries) ? res.data.entries : [];
  render();
};

const refreshStatus = async () => {
  const res = await sendApiMessage("VAULT_STATUS");
  if (!res.ok) {
    setToast(res.error?.message || "No se pudo obtener el estado del vault.", "error");
    render();
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
  if (!id) return null;
  if (state.selectedSecret?.id === id) return state.selectedSecret;

  const res = await sendApiMessage("ENTRY_GET_SECRET", { id });
  if (!res.ok) {
    setToast(res.error?.message || "No se pudo obtener el secreto.", "error");
    render();
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
      ${state.createError ? `<p class="error">${escapeHtml(state.createError)}</p>` : ""}
      <button class="primary" type="submit">Crear vault</button>
    </form>
  `;
};

const renderUnlock = () => {
  const vaultHint = state.vaultName
    ? `Vault: ${escapeHtml(state.vaultName)}`
    : "Vault detectado.";

  return `
    <h1>Unlock vault</h1>
    <p class="muted">${vaultHint}</p>
    <form data-action="unlock-vault" class="stack">
      <label class="field">
        <span>Master password</span>
        <input name="master" type="password" required />
      </label>
      ${state.unlockError ? `<p class="error">${escapeHtml(state.unlockError)}</p>` : ""}
      <button class="primary" type="submit">Desbloquear</button>
    </form>
  `;
};

const renderList = () => {
  const needle = state.search.trim().toLowerCase();
  const visibleEntries = state.entries.filter((entry) => {
    if (!needle) {
      return true;
    }
    return (
      entry.title.toLowerCase().includes(needle) ||
      entry.username.toLowerCase().includes(needle) ||
      entry.notes.toLowerCase().includes(needle)
    );
  });

  return `
    <div class="toolbar">
      <h1>Vault entries</h1>
      <div class="toolbar-actions">
        <button type="button" data-action="to-add" class="primary">+ Add</button>
        <button type="button" data-action="lock">Lock</button>
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
                      <strong>${escapeHtml(entry.title)}</strong>
                      <span>${escapeHtml(entry.username || "sin usuario")}</span>
                    </button>
                  </li>
                `;
              })
              .join("")
      }
    </ul>
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
      ${state.formError ? `<p class="error">${escapeHtml(state.formError)}</p>` : ""}
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
      <dd>${escapeHtml(entry.title)}</dd>

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
  root.innerHTML = `
    <main class="popup">
      ${state.toastMessage ? `<div class="toast ${state.toastTone}">${escapeHtml(state.toastMessage)}</div>` : ""}

      <header class="row">
        <span class="chip">${routeLabels[state.route]}</span>
      </header>

      <section class="card">
        ${routeBody()}
      </section>
    </main>
  `;
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
      state.createError = "Completa ambos campos de master password.";
      render();
      return;
    }
    if (master.length < 8) {
      state.createError = "La master password debe tener al menos 8 caracteres.";
      render();
      return;
    }
    if (master !== confirm) {
      state.createError = "Las contrasenas no coinciden.";
      render();
      return;
    }

    const res = await sendApiMessage("VAULT_CREATE", {
      masterPassword: master,
      confirmPassword: confirm,
      vaultName: vaultName || undefined
    });

    if (!res.ok) {
      state.createError = res.error?.message || "No se pudo crear el vault.";
      render();
      return;
    }

    state.createError = "";
    setToast("Vault creado.", "success");
    await refreshStatus();
    return;
  }

  if (action === "unlock-vault") {
    const master = String(data.get("master") ?? "");
    if (!master) {
      state.unlockError = "Introduce tu master password.";
      render();
      return;
    }

    const res = await sendApiMessage("VAULT_UNLOCK", { masterPassword: master });
    if (!res.ok) {
      state.unlockError = res.error?.message || "No se pudo desbloquear.";
      render();
      return;
    }

    state.unlockError = "";
    setToast("Vault desbloqueado.", "success");
    await refreshStatus();
    return;
  }

  if (action === "save-entry") {
    const title = String(data.get("title") ?? "").trim();
    const username = String(data.get("username") ?? "").trim();
    const password = String(data.get("password") ?? "").trim();
    const notes = String(data.get("notes") ?? "").trim();

    if (!title || !password) {
      state.formError = "Titulo y password son obligatorios.";
      render();
      return;
    }

    const mode = form.dataset.mode;
    if (mode === "edit" && state.selectedEntryId) {
      const res = await sendApiMessage("ENTRY_UPDATE", {
        entry: { id: state.selectedEntryId, title, username: username || undefined, password, notes: notes || undefined }
      });
      if (!res.ok) {
        state.formError = res.error?.message || "No se pudo guardar.";
        render();
        return;
      }

      state.formError = "";
      state.screen = "DETAIL";
      state.detailPasswordVisible = false;
      state.selectedSecret = { id: state.selectedEntryId, username, password };
      setToast("Entry actualizada.", "success");
      await refreshEntries();
      render();
      return;
    }

    const res = await sendApiMessage("ENTRY_ADD", {
      entry: { title, username: username || undefined, password, notes: notes || undefined }
    });
    if (!res.ok) {
      state.formError = res.error?.message || "No se pudo guardar.";
      render();
      return;
    }

    state.formError = "";
    await refreshEntries();
    const createdId = res.data?.entry?.id;
    if (createdId) {
      selectEntry(createdId);
      state.selectedSecret = { id: createdId, username, password };
    } else {
      state.screen = "LIST";
    }
    setToast("Entry creada.", "success");
    render();
  }
});

root.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
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
  const action = actionButton?.dataset.action;
  if (!action) {
    return;
  }

  if (action === "lock") {
    const res = await sendApiMessage("VAULT_LOCK");
    if (!res.ok) {
      setToast(res.error?.message || "No se pudo bloquear.", "error");
      return;
    }
    setToast("Vault bloqueado.", "info");
    await refreshStatus();
    return;
  }
  if (action === "to-add") {
    state.formError = "";
    state.formPasswordVisible = false;
    state.screen = "FORM_ADD";
    render();
    return;
  }
  if (action === "to-list") {
    state.formError = "";
    state.detailPasswordVisible = false;
    state.screen = "LIST";
    render();
    return;
  }
  if (action === "to-edit") {
    state.formError = "";
    state.formPasswordVisible = false;
    const okSecret = await ensureSelectedSecret();
    if (!okSecret) {
      return;
    }
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
      const okSecret = await ensureSelectedSecret();
      if (!okSecret) {
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
    if (action === "copy-password") {
      const okSecret = await ensureSelectedSecret();
      if (!okSecret?.password) {
        setToast("No hay valor para copiar.", "error");
        return;
      }
      try {
        await copyText(okSecret.password);
        setToast("Password copiada.", "success");
      } catch (_error) {
        setToast("No se pudo copiar al portapapeles.", "error");
      }
      return;
    }

    const value = entry.username || (state.selectedSecret?.id === entry.id ? state.selectedSecret.username : "");
    if (!value) {
      setToast("No hay valor para copiar.", "error");
      return;
    }
    try {
      await copyText(value);
      setToast("Usuario copiado.", "success");
    } catch (_error) {
      setToast("No se pudo copiar al portapapeles.", "error");
    }
  }
});

render();
refreshStatus().catch(() => {
  setToast("No se pudo inicializar el estado del vault.", "error");
  render();
});
