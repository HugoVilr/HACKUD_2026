import type { AutofillCandidate } from "../shared/messages.ts";

type MiniButtonState = "idle" | "checking" | "locked" | "ready" | "error";

type SecretResponse = {
  ok: boolean;
  data?: { secret?: { id: string; username: string; password: string } };
  error?: { message?: string };
};

type OpenPopupResponse = {
  ok: boolean;
  data?: { opened?: boolean };
  error?: { message?: string };
};

const BUTTON_ID = "g8keeper-autofill-btn";
const BUTTON_CLASS = "g8keeper-autofill-btn";
const PANEL_ID = "g8keeper-autofill-panel";
const PANEL_CLASS = "g8keeper-autofill-panel";

let activeInput: HTMLInputElement | null = null;
let lastFocusedInput: HTMLInputElement | null = null;
let hideTimeout: number | null = null;
let selectedEntryId: string | null = null;
let awaitingUnlockFromPopup = false;

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  return "Error desconocido";
}

async function sendMessageSafe<T = any>(message: unknown): Promise<T> {
  if (!chrome?.runtime?.id) {
    throw new Error("runtime no disponible (recarga la extension y la pagina)");
  }
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

async function openUnlockPopup(): Promise<void> {
  awaitingUnlockFromPopup = true;
  const res = await sendMessageSafe<OpenPopupResponse>({ type: "UI_OPEN_POPUP" });
  if (res?.ok) {
    renderPanelMessage("Introduce la master password en el popup de la extension.");
    window.setTimeout(() => restoreFloatingUiAfterReturn(), 120);
    return;
  }

  const fallbackUrl = chrome.runtime.getURL("src/popup/popup.html");
  window.open(fallbackUrl, "_blank", "noopener");
  renderPanelMessage("No se pudo abrir el popup. Abri una pestana de la extension para desbloquear.", "warning");
  window.setTimeout(() => restoreFloatingUiAfterReturn(), 120);
}

function isFillableInput(el: EventTarget | null): el is HTMLInputElement {
  if (!(el instanceof HTMLInputElement)) return false;
  if (el.disabled || el.readOnly) return false;
  // No mostrar autofill en inputs propios de G8keeper (modal de crear credencial).
  if (el.closest("#g8keeper-create-modal")) return false;
  if (el.id.startsWith("g8keeper-")) return false;
  if (el.name.startsWith("g8keeper-")) return false;
  if ("g8keeper" in el.dataset) return false;

  const type = (el.type || "text").toLowerCase();
  return type === "password" || type === "email" || type === "text";
}

function isUsableInput(input: HTMLInputElement | null | undefined): input is HTMLInputElement {
  if (!input) return false;
  if (input.disabled || input.readOnly) return false;
  if (input.type === "hidden") return false;
  return input.getClientRects().length > 0;
}

function getButton(): HTMLButtonElement {
  let btn = document.getElementById(BUTTON_ID) as HTMLButtonElement | null;
  if (btn) return btn;

  btn = document.createElement("button");
  btn.id = BUTTON_ID;
  btn.className = BUTTON_CLASS;
  btn.type = "button";
  btn.setAttribute("aria-label", "G8keeper Autofill");
  btn.setAttribute("title", "G8keeper Autofill");
  btn.dataset.state = "idle";

  const icon = document.createElement("span");
  icon.className = "g8keeper-autofill-btn__icon";
  icon.setAttribute("aria-hidden", "true");
  btn.appendChild(icon);

  btn.addEventListener("mousedown", (ev) => {
    ev.preventDefault();
  });

  btn.addEventListener("click", async () => {
    if (!activeInput) return;
    await openSuggestions();
  });

  document.documentElement.appendChild(btn);
  return btn;
}

function getPanel(): HTMLDivElement {
  let panel = document.getElementById(PANEL_ID) as HTMLDivElement | null;
  if (panel) return panel;

  panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.className = PANEL_CLASS;

  panel.addEventListener("mousedown", (ev) => {
    ev.preventDefault();
  });

  document.documentElement.appendChild(panel);
  return panel;
}

function setButtonState(state: MiniButtonState): void {
  const btn = getButton();
  btn.dataset.state = state;

  if (state === "idle") btn.title = "G8keeper Autofill";
  if (state === "checking") btn.title = "Comprobando estado...";
  if (state === "locked") btn.title = "Vault bloqueado";
  if (state === "ready") btn.title = "Vault listo";
  if (state === "error") btn.title = "Error de conexion";
}

function positionFloatingUi(input: HTMLInputElement): void {
  const btn = getButton();
  const panel = getPanel();
  const rect = input.getBoundingClientRect();
  const btnSize = 34;
  const viewportPadding = 8;
  const insideOffset = 8;

  const rawLeft = rect.right - btnSize - insideOffset;
  const boundedLeft = Math.min(
    window.innerWidth - btnSize - viewportPadding,
    Math.max(viewportPadding, rawLeft)
  );

  btn.style.left = `${boundedLeft}px`;
  btn.style.top = `${Math.max(viewportPadding, rect.top + (rect.height - btnSize) / 2)}px`;
  btn.classList.add("g8keeper-autofill-btn--visible");

  panel.style.left = `${Math.max(8, rect.left)}px`;
  panel.style.top = `${Math.max(8, rect.bottom + 8)}px`;
  panel.style.width = `${Math.min(360, Math.max(240, rect.width))}px`;
}

function hideFloatingUiSoon(): void {
  if (hideTimeout) window.clearTimeout(hideTimeout);
  hideTimeout = window.setTimeout(() => {
    const btn = getButton();
    const panel = getPanel();
    btn.classList.remove("g8keeper-autofill-btn--visible");
    panel.classList.remove("g8keeper-autofill-panel--visible");
    activeInput = null;
  }, 180);
}

function hideFloatingUiNow(): void {
  const btn = getButton();
  const panel = getPanel();
  btn.classList.remove("g8keeper-autofill-btn--visible");
  panel.classList.remove("g8keeper-autofill-panel--visible");
  activeInput = null;
}

function restoreFloatingUiAfterReturn(): void {
  if (activeInput) return;
  if (!isUsableInput(lastFocusedInput)) return;

  activeInput = lastFocusedInput;
  positionFloatingUi(activeInput);
  setButtonState("idle");
}

async function syncUnlockStateAfterReturn(): Promise<void> {
  if (!awaitingUnlockFromPopup) return;

  try {
    const status = await sendMessageSafe<any>({ type: "VAULT_STATUS" });
    if (status?.ok && status.data?.hasVault && !status.data?.locked) {
      // Unlock correcto: ocultar candado y mensaje.
      awaitingUnlockFromPopup = false;
      hideFloatingUiNow();
      return;
    }
  } catch {
    // Ignore.
  }

  // Sigue bloqueado: mantener espera hasta que el usuario desbloquee de verdad.
  awaitingUnlockFromPopup = true;
  restoreFloatingUiAfterReturn();
  setButtonState("locked");
}

function renderPanelMessage(message: string, tone: "info" | "warning" = "info"): void {
  const panel = getPanel();
  panel.replaceChildren();

  const row = document.createElement("div");
  row.className = `g8keeper-autofill-panel__message g8keeper-autofill-panel__message--${tone}`;
  row.textContent = message;

  panel.appendChild(row);
  panel.classList.add("g8keeper-autofill-panel--visible");
}

function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  if (descriptor?.set) descriptor.set.call(input, value);
  else input.value = value;

  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function getScope(origin: HTMLInputElement): ParentNode {
  return origin.form ?? origin.closest("form") ?? document;
}

function queryInputs(scope: ParentNode, selector: string): HTMLInputElement[] {
  return Array.from(scope.querySelectorAll(selector)).filter(isUsableInput);
}

function findPasswordInput(origin: HTMLInputElement): HTMLInputElement | null {
  if (origin.type.toLowerCase() === "password" && isUsableInput(origin)) {
    return origin;
  }

  const scoped = queryInputs(getScope(origin), 'input[type="password"]');
  if (scoped[0]) return scoped[0];

  const global = queryInputs(document, 'input[type="password"]');
  return global[0] ?? null;
}

function findUsernameInput(origin: HTMLInputElement, passwordField: HTMLInputElement | null): HTMLInputElement | null {
  const selectors = [
    'input[autocomplete="username"]',
    'input[autocomplete="email"]',
    'input[type="email"]',
    'input[name*="user" i], input[id*="user" i]',
    'input[name*="email" i], input[id*="email" i]',
    'input[name*="login" i], input[id*="login" i]',
    'input[type="text"]',
  ];

  const scope = getScope(origin);
  for (const selector of selectors) {
    const found = queryInputs(scope, selector).find((input) => input !== passwordField);
    if (found) return found;
  }

  for (const selector of selectors) {
    const found = queryInputs(document, selector).find((input) => input !== passwordField);
    if (found) return found;
  }

  return null;
}

function fillCredentials(origin: HTMLInputElement, username: string, password: string): { usernameFilled: boolean; passwordFilled: boolean } {
  const passwordField = findPasswordInput(origin);
  const usernameField = findUsernameInput(origin, passwordField);

  let usernameFilled = false;
  let passwordFilled = false;

  if (usernameField && username) {
    setNativeInputValue(usernameField, username);
    usernameFilled = true;
  }

  if (passwordField && password) {
    setNativeInputValue(passwordField, password);
    passwordField.focus();
    passwordFilled = true;
  }

  return { usernameFilled, passwordFilled };
}

async function selectCandidate(candidate: AutofillCandidate): Promise<void> {
  if (!activeInput) {
    renderPanelMessage("No hay campo activo para rellenar", "warning");
    return;
  }

  selectedEntryId = candidate.id;
  renderPanelMessage(`Rellenando ${candidate.title}...`);

  try {
    const res = await sendMessageSafe<SecretResponse>({
      type: "ENTRY_GET_SECRET",
      payload: { id: candidate.id },
    });

    if (!res?.ok) {
      renderPanelMessage(res?.error?.message || "No se pudo obtener el secreto", "warning");
      return;
    }

    const secret = res.data?.secret;
    if (!secret) {
      renderPanelMessage("Secreto no disponible", "warning");
      return;
    }

    let user = String(secret.username ?? "");
    let pass = String(secret.password ?? "");

    const { usernameFilled, passwordFilled } = fillCredentials(activeInput, user, pass);

    if (passwordFilled || usernameFilled) {
      renderPanelMessage("Campos rellenados correctamente.");
    } else {
      renderPanelMessage("No pude encontrar campos compatibles en esta pagina", "warning");
    }

    // Best effort cleanup de referencias sensibles.
    user = "\0".repeat(user.length);
    user = "";
    pass = "\0".repeat(pass.length);
    pass = "";
  } catch (err) {
    renderPanelMessage(`Error rellenando: ${errorMessage(err)}`, "warning");
  }
}

function renderCandidates(candidates: AutofillCandidate[]): void {
  const panel = getPanel();
  panel.replaceChildren();

  const title = document.createElement("div");
  title.className = "g8keeper-autofill-panel__title";
  title.textContent = "Credenciales disponibles";
  panel.appendChild(title);

  for (const candidate of candidates) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "g8keeper-autofill-panel__item";

    const top = document.createElement("span");
    top.className = "g8keeper-autofill-panel__item-title";
    top.textContent = candidate.title;

    const meta = document.createElement("span");
    meta.className = "g8keeper-autofill-panel__item-meta";
    const username = candidate.username || "sin usuario";
    const domain = candidate.domain || "sin dominio";
    meta.textContent = `${username} · ${domain}`;

    item.appendChild(top);
    item.appendChild(meta);

    item.addEventListener("click", async () => {
      await selectCandidate(candidate);
    });

    panel.appendChild(item);
  }

  panel.classList.add("g8keeper-autofill-panel--visible");
}

async function openSuggestions(): Promise<void> {
  setButtonState("checking");
  renderPanelMessage("Buscando estado del vault...");

  try {
    const status = await sendMessageSafe<any>({ type: "VAULT_STATUS" });
    if (!status?.ok) {
      setButtonState("error");
      renderPanelMessage(status?.error?.message || "No se pudo consultar el vault", "warning");
      return;
    }

    if (!status.data?.hasVault) {
      setButtonState("locked");
      renderPanelMessage("No hay vault creado. Crea uno desde el popup.", "warning");
      return;
    }

    if (status.data?.locked) {
      setButtonState("locked");
      await openUnlockPopup();
      return;
    }

    setButtonState("ready");

    const hostname = window.location.hostname;
    const res = await sendMessageSafe<any>({
      type: "AUTOFILL_QUERY_BY_DOMAIN",
      payload: { hostname },
    });

    if (!res?.ok) {
      renderPanelMessage(res?.error?.message || "No se pudieron obtener sugerencias", "warning");
      return;
    }

    const candidates = Array.isArray(res.data?.entries) ? (res.data.entries as AutofillCandidate[]) : [];
    if (candidates.length === 0) {
      renderPanelMessage(`No hay credenciales para ${hostname}`, "warning");
      return;
    }

    renderCandidates(candidates);
  } catch (err) {
    setButtonState("error");
    renderPanelMessage(
      `Error de comunicacion: ${errorMessage(err)}. Si persiste, recarga extension y pagina.`,
      "warning"
    );
  }
}

window.addEventListener("focusin", (ev) => {
  if (!isFillableInput(ev.target)) return;
  activeInput = ev.target;
  lastFocusedInput = ev.target;
  selectedEntryId = null;
  if (hideTimeout) window.clearTimeout(hideTimeout);
  positionFloatingUi(activeInput);
  setButtonState("idle");
});

window.addEventListener(
  "scroll",
  () => {
    if (!activeInput) return;
    positionFloatingUi(activeInput);
  },
  true
);

window.addEventListener("resize", () => {
  if (!activeInput) return;
  positionFloatingUi(activeInput);
});

window.addEventListener("focusout", () => {
  // Si la pagina pierde foco (por ejemplo al abrir el popup), no ocultar.
  if (!document.hasFocus()) return;
  hideFloatingUiSoon();
});

window.addEventListener("focus", () => {
  restoreFloatingUiAfterReturn();
  void syncUnlockStateAfterReturn();
});

window.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    restoreFloatingUiAfterReturn();
    void syncUnlockStateAfterReturn();
  }
});

window.addEventListener("pageshow", () => {
  restoreFloatingUiAfterReturn();
  void syncUnlockStateAfterReturn();
});
