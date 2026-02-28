import type { VaultEntry } from "../../../core/vault/types.ts";
import type { PopupState } from "../../app/state/popupState.ts";

type RenderDeps = {
  escapeHtml: (value: unknown) => string;
  maskPassword: (value: string) => string;
  getSelectedEntry: () => VaultEntry | null;
};

const renderCreateVault = (state: PopupState, deps: RenderDeps): string => {
  if (state.recoveryCodes && state.recoveryCodes.length > 0) {
    return `
      <div class="recovery-codes-screen">
        <h1>🔐 Códigos de Recuperación</h1>
        <p class="muted warning-text">
          ⚠️ <strong>IMPORTANTE:</strong> Guarda estos códigos en un lugar seguro.
          Son la única forma de recuperar tu vault si olvidas tu contraseña maestra.
        </p>

        <div class="recovery-codes-list">
          ${state.recoveryCodes
            .map(
              (code, i) => `
            <div class="recovery-code-item">
              <span class="code-number">${i + 1}.</span>
              <code class="code-text">${deps.escapeHtml(code)}</code>
            </div>
          `,
            )
            .join("")}
        </div>

        <div class="recovery-codes-info">
          <ul>
            <li>✓ Cada código puede usarse <strong>UNA SOLA VEZ</strong></li>
            <li>✓ Tienen 256 bits de entropía (ultra seguros)</li>
            <li>✓ NO los compartas con nadie</li>
            <li>✓ Imprímelos y guárdalos físicamente</li>
          </ul>
        </div>

        <div class="stack">
          <button type="button" data-action="copy-recovery-codes" class="secondary">
            📋 Copiar todos
          </button>
          <button type="button" data-action="export-recovery-codes" class="secondary">
            💾 Exportar como .txt
          </button>

          <label class="field checkbox-field">
            <input type="checkbox" data-action="toggle-recovery-ack" ${
              state.recoveryCodesAcknowledged ? "checked" : ""
            } />
            <span>He guardado mis códigos de recuperación en un lugar seguro</span>
          </label>

          <button
            type="button"
            data-action="done-recovery-codes"
            class="primary"
            ${!state.recoveryCodesSaved || !state.recoveryCodesAcknowledged ? "disabled" : ""}
          >
            Continuar
          </button>
        </div>
      </div>
    `;
  }

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

const renderUnlock = (state: PopupState, deps: RenderDeps): string => {
  const vaultHint = state.vaultName
    ? `Vault: ${deps.escapeHtml(state.vaultName)}`
    : "Vault local detectado. Introduce tu master password.";

  if (state.showRecoveryCodeUnlock) {
    return `
      <h1>Recovery Code</h1>
      <p class="muted">Introduce uno de tus códigos de recuperación</p>
      <form data-action="unlock-recovery" class="stack">
        <label class="field">
          <span>Recovery Code</span>
          <input name="recoveryCode" type="text" required placeholder="Pega aquí tu recovery code" />
        </label>
        <button class="primary" type="submit">Desbloquear</button>
        <button type="button" data-action="cancel-recovery" class="secondary">Volver a master password</button>
      </form>
    `;
  }

  return `
    <h1>Unlock vault</h1>
    <p class="muted">${vaultHint}</p>
    <form data-action="unlock-vault" class="stack">
      <label class="field">
        <span>Master password</span>
        <input name="master" type="password" required value="${deps.escapeHtml(state.unlockMasterDraft)}" />
      </label>
      <button class="primary" type="submit">Desbloquear</button>
      <button type="button" data-action="show-recovery" class="secondary">¿Olvidaste tu contraseña?</button>
    </form>
  `;
};

const renderList = (state: PopupState, deps: RenderDeps): string => {
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
      String(entry.domain || "").toLowerCase().includes(needle) ||
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
          <button type="button" data-action="run-hibp-audit">Leak audit</button>
          <button type="button" data-action="lock">Lock</button>
          <button type="button" data-action="show-delete" class="caution-button">Eliminar Vault</button>
        </div>
      </div>

      <label class="field">
        <span>Buscar</span>
        <input
          data-action="search"
          type="search"
          value="${deps.escapeHtml(state.search)}"
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
                        <strong>${deps.escapeHtml(entry.title || "")}</strong>
                        <span>${deps.escapeHtml(entry.username || "sin usuario")}</span>
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

const renderEntryForm = (state: PopupState, deps: RenderDeps, mode: "add" | "edit"): string => {
  const entry = mode === "edit" ? deps.getSelectedEntry() : null;
  const title = entry?.title ?? "";
  const domain = entry?.domain ?? "";
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
        <input name="title" type="text" required maxlength="60" value="${deps.escapeHtml(title)}" />
      </label>
      <label class="field">
        <span>Dominio (opcional)</span>
        <input name="domain" type="text" maxlength="120" placeholder="ej: github.com" value="${deps.escapeHtml(domain)}" />
      </label>
      <label class="field">
        <span>Usuario</span>
        <input name="username" type="text" maxlength="80" value="${deps.escapeHtml(username)}" />
      </label>
      <label class="field">
        <span>Password</span>
        <div class="inline-row">
          <input
            name="password"
            type="${state.formPasswordVisible ? "text" : "password"}"
            required
            maxlength="100"
            value="${deps.escapeHtml(password)}"
          />
          <button type="button" data-action="toggle-form-password">
            ${state.formPasswordVisible ? "Ocultar" : "Revelar"}
          </button>
        </div>
      </label>
      <label class="field">
        <span>Notas</span>
        <textarea name="notes" rows="3" maxlength="280">${deps.escapeHtml(notes)}</textarea>
      </label>
      <button class="primary" type="submit">Guardar</button>
    </form>
  `;
};

const renderEntryDetail = (state: PopupState, deps: RenderDeps): string => {
  const entry = deps.getSelectedEntry();
  if (!entry) {
    state.screen = "LIST";
    return renderList(state, deps);
  }

  const password = state.selectedSecret?.id === entry.id ? state.selectedSecret.password : "";

  return `
    <div class="toolbar">
      <h1>Entry detail</h1>
      <div class="toolbar-actions">
        <button type="button" data-action="to-list">Volver</button>
        <button type="button" data-action="to-edit" class="primary">Editar</button>
        <button type="button" data-action="delete-entry" class="caution-button">Eliminar</button>
      </div>
    </div>

    <dl class="detail-grid">
      <dt>Titulo</dt>
      <dd>${deps.escapeHtml(entry.title || "")}</dd>

      <dt>Dominio</dt>
      <dd>${deps.escapeHtml(entry.domain || "-")}</dd>

      <dt>Usuario</dt>
      <dd>
        <div class="inline-row">
          <span>${deps.escapeHtml(entry.username || "-")}</span>
          <button type="button" data-action="copy-username">Copiar</button>
        </div>
      </dd>

      <dt>Password</dt>
      <dd>
        <div class="inline-row">
          <code class="secret">${deps.escapeHtml(
            state.detailPasswordVisible ? password || "-" : deps.maskPassword(password || ""),
          )}</code>
          <button type="button" data-action="toggle-detail-password">
            ${state.detailPasswordVisible ? "Ocultar" : "Revelar"}
          </button>
          <button type="button" data-action="copy-password">Copiar</button>
        </div>
      </dd>

      <dt>Notas</dt>
      <dd>${deps.escapeHtml(entry.notes || "-")}</dd>
    </dl>
  `;
};

const renderUnlocked = (state: PopupState, deps: RenderDeps): string => {
  switch (state.screen) {
    case "FORM_ADD":
      return renderEntryForm(state, deps, "add");
    case "FORM_EDIT":
      return renderEntryForm(state, deps, "edit");
    case "DETAIL":
      return renderEntryDetail(state, deps);
    default:
      return renderList(state, deps);
  }
};

export const renderRouteBody = (state: PopupState, deps: RenderDeps): string => {
  if (state.recoveryCodes && state.recoveryCodes.length > 0) {
    return renderCreateVault(state, deps);
  }

  switch (state.route) {
    case "NO_VAULT":
      return renderCreateVault(state, deps);
    case "LOCKED":
      return renderUnlock(state, deps);
    case "UNLOCKED":
      return renderUnlocked(state, deps);
    default:
      return "";
  }
};
