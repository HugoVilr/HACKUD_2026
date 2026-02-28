/**
 * CONTENT SCRIPT: Auto-capture de credenciales
 * 
 * Este script se ejecuta en todas las páginas web y detecta:
 * 1. Formularios de registro (signup) - Sugiere crear desde vault
 * 2. Formularios enviados exitosamente - Sugiere guardar credenciales
 * 
 * SECURITY CONSIDERATIONS:
 * - Solo captura después de confirmación del usuario
 * - Solo funciona si el vault está desbloqueado
 * - No intercepta passwords hasta que el usuario acepta
 * - Comunica con background vía chrome.runtime.sendMessage
 */

interface CapturedFormData {
  url: string;
  title: string;
  username: string;
  password: string;
}

interface DetectedForm {
  form: HTMLFormElement;
  usernameField: HTMLInputElement | null;
  passwordField: HTMLInputElement | null;
  isSignup: boolean;
}

/**
 * Detectar si un formulario es de registro (signup) vs login
 * 
 * Heurísticas:
 * - Tiene campo "confirm password" → signup
 * - Tiene campo "email" pero no "username" → signup
 * - Texto del botón: "sign up", "register", "create account" → signup
 * - URL contiene: /signup, /register, /join → signup
 */
function isSignupForm(form: HTMLFormElement): boolean {
  // Buscar campo de confirmación de password
  const confirmPasswordField = form.querySelector<HTMLInputElement>(
    'input[type="password"][name*="confirm"], input[type="password"][id*="confirm"]'
  );
  if (confirmPasswordField) return true;

  // Buscar campo de email sin username (común en signups)
  const emailField = form.querySelector<HTMLInputElement>(
    'input[type="email"], input[name*="email"], input[id*="email"]'
  );
  const usernameField = form.querySelector<HTMLInputElement>(
    'input[name*="username"], input[id*="username"]'
  );
  if (emailField && !usernameField) return true;

  // Analizar texto del botón submit
  const submitButton = form.querySelector<HTMLButtonElement>(
    'button[type="submit"], input[type="submit"]'
  );
  const buttonText = submitButton?.textContent?.toLowerCase() || submitButton?.value.toLowerCase() || '';
  if (buttonText.match(/sign\s*up|register|create\s*account|join/)) return true;

  // Analizar URL
  const url = window.location.href.toLowerCase();
  if (url.match(/\/signup|\/register|\/join|\/create-account/)) return true;

  return false;
}

/**
 * Detectar formularios de login/signup en la página
 */
function detectForms(): DetectedForm[] {
  const forms = Array.from(document.querySelectorAll<HTMLFormElement>('form'));
  const detected: DetectedForm[] = [];

  for (const form of forms) {
    // Buscar campos de password
    const passwordFields = Array.from(
      form.querySelectorAll<HTMLInputElement>('input[type="password"]')
    );
    
    if (passwordFields.length === 0) continue;

    // Buscar campo de username/email
    const usernameField = form.querySelector<HTMLInputElement>(
      'input[type="email"], input[type="text"][name*="user"], input[type="text"][name*="email"], input[id*="user"], input[id*="email"]'
    );

    const passwordField = passwordFields[0]; // Primer campo de password
    const isSignup = isSignupForm(form);

    detected.push({
      form,
      usernameField,
      passwordField,
      isSignup,
    });
  }

  return detected;
}

/**
 * Verificar si el vault está desbloqueado
 */
async function isVaultUnlocked(): Promise<boolean> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'VAULT_STATUS',
    });

    return response?.ok && response?.data?.hasVault && !response?.data?.locked;
  } catch (error) {
    console.error('[G8keeper] Error checking vault status:', error);
    return false;
  }
}

/**
 * Mostrar notification sugiriendo crear cuenta desde vault
 */
function showSignupSuggestion(form: HTMLFormElement): void {
  // Evitar duplicados
  if (form.dataset.g8keeperNotified === 'true') return;
  form.dataset.g8keeperNotified = 'true';

  // Crear notification visual
  const notification = document.createElement('div');
  notification.id = 'g8keeper-signup-notification';
  notification.innerHTML = `
    <div style="
      position: fixed;
      top: 20px;
      right: 20px;
      background: #1976d2;
      color: white;
      padding: 16px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 999999;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      max-width: 320px;
      animation: slideIn 0.3s ease-out;
    ">
      <div style="display: flex; align-items: start; gap: 12px;">
        <span style="font-size: 24px;">🔐</span>
        <div style="flex: 1;">
          <strong style="display: block; margin-bottom: 4px;">G8keeper detectó un formulario de registro</strong>
          <p style="margin: 0 0 12px 0; opacity: 0.9; font-size: 13px;">¿Quieres crear una contraseña segura desde el vault?</p>
          <div style="display: flex; gap: 8px;">
            <button id="g8keeper-accept" style="
              background: white;
              color: #1976d2;
              border: none;
              padding: 6px 12px;
              border-radius: 4px;
              cursor: pointer;
              font-weight: 500;
              font-size: 13px;
            ">Abrir Vault</button>
            <button id="g8keeper-dismiss" style="
              background: transparent;
              color: white;
              border: 1px solid rgba(255,255,255,0.5);
              padding: 6px 12px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 13px;
            ">Ignorar</button>
          </div>
        </div>
        <button id="g8keeper-close" style="
          background: transparent;
          border: none;
          color: white;
          cursor: pointer;
          font-size: 20px;
          padding: 0;
          line-height: 1;
        ">×</button>
      </div>
    </div>
    <style>
      @keyframes slideIn {
        from {
          transform: translateX(400px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
    </style>
  `;

  document.body.appendChild(notification);

  // Event listeners
  const acceptBtn = notification.querySelector('#g8keeper-accept');
  const dismissBtn = notification.querySelector('#g8keeper-dismiss');
  const closeBtn = notification.querySelector('#g8keeper-close');

  const remove = () => notification.remove();

  acceptBtn?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ 
      type: 'OPEN_POPUP_FOR_SIGNUP',
      payload: {
        url: window.location.href,
        title: document.title,
      }
    });
    remove();
  });

  dismissBtn?.addEventListener('click', remove);
  closeBtn?.addEventListener('click', remove);

  // Auto-dismiss después de 15 segundos
  setTimeout(remove, 15000);
}

/**
 * Capturar datos del formulario después de submit exitoso
 */
function captureFormData(detected: DetectedForm): CapturedFormData | null {
  const { usernameField, passwordField } = detected;

  if (!usernameField || !passwordField) return null;

  const username = usernameField.value.trim();
  const password = passwordField.value;

  if (!username || !password) return null;

  return {
    url: window.location.origin,
    title: document.title,
    username,
    password,
  };
}

/**
 * Mostrar notification para guardar credenciales después de submit
 */
function showSaveSuggestion(formData: CapturedFormData): void {
  const notification = document.createElement('div');
  notification.id = 'g8keeper-save-notification';
  notification.innerHTML = `
    <div style="
      position: fixed;
      top: 20px;
      right: 20px;
      background: #2e7d32;
      color: white;
      padding: 16px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 999999;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      max-width: 320px;
      animation: slideIn 0.3s ease-out;
    ">
      <div style="display: flex; align-items: start; gap: 12px;">
        <span style="font-size: 24px;">✅</span>
        <div style="flex: 1;">
          <strong style="display: block; margin-bottom: 4px;">¿Guardar en G8keeper?</strong>
          <p style="margin: 0 0 8px 0; opacity: 0.9; font-size: 13px;">Usuario: ${escapeHtmlContent(formData.username)}</p>
          <div style="display: flex; gap: 8px;">
            <button id="g8keeper-save-accept" style="
              background: white;
              color: #2e7d32;
              border: none;
              padding: 6px 12px;
              border-radius: 4px;
              cursor: pointer;
              font-weight: 500;
              font-size: 13px;
            ">Guardar</button>
            <button id="g8keeper-save-dismiss" style="
              background: transparent;
              color: white;
              border: 1px solid rgba(255,255,255,0.5);
              padding: 6px 12px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 13px;
            ">No</button>
          </div>
        </div>
        <button id="g8keeper-save-close" style="
          background: transparent;
          border: none;
          color: white;
          cursor: pointer;
          font-size: 20px;
          padding: 0;
          line-height: 1;
        ">×</button>
      </div>
    </div>
  `;

  document.body.appendChild(notification);

  const acceptBtn = notification.querySelector('#g8keeper-save-accept');
  const dismissBtn = notification.querySelector('#g8keeper-save-dismiss');
  const closeBtn = notification.querySelector('#g8keeper-save-close');

  const remove = () => notification.remove();

  acceptBtn?.addEventListener('click', async () => {
    try {
      await chrome.runtime.sendMessage({
        type: 'ENTRY_ADD',
        payload: {
          entry: {
            title: formData.title,
            username: formData.username,
            password: formData.password,
            notes: `Auto-captured from ${formData.url}`,
          },
        },
      });

      // Mostrar confirmación
      const confirm = document.createElement('div');
      confirm.textContent = '✅ Guardado en vault';
      confirm.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #2e7d32;
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        z-index: 999999;
        font-family: system-ui;
        font-size: 14px;
      `;
      document.body.appendChild(confirm);
      setTimeout(() => confirm.remove(), 3000);
    } catch (error) {
      console.error('[G8keeper] Error saving entry:', error);
    }
    remove();
  });

  dismissBtn?.addEventListener('click', remove);
  closeBtn?.addEventListener('click', remove);

  setTimeout(remove, 15000);
}

function escapeHtmlContent(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Monitorear formularios detectados
 */
async function monitorForms(): Promise<void> {
  const unlocked = await isVaultUnlocked();
  if (!unlocked) return; // Solo funciona con vault desbloqueado

  const detected = detectForms();

  for (const { form, isSignup, ...rest } of detected) {
    // Flujo 1: Sugerir crear desde vault si es signup
    if (isSignup) {
      showSignupSuggestion(form);
    }

    // Flujo 2: Capturar después de submit exitoso
    form.addEventListener('submit', async (event) => {
      const formData = captureFormData({ form, isSignup, ...rest });
      if (!formData) return;

      // Esperar un poco para ver si el submit fue exitoso
      // (si la página redirige o no muestra error)
      setTimeout(async () => {
        // Si seguimos en la misma página, probablemente hubo error
        // Si navegamos o la página cambió, probablemente fue exitoso
        const stillUnlocked = await isVaultUnlocked();
        if (stillUnlocked && !form.querySelector('.error, .invalid, [aria-invalid="true"]')) {
          showSaveSuggestion(formData);
        }
      }, 1500);
    });
  }
}

// Ejecutar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', monitorForms);
} else {
  monitorForms();
}

// Re-ejecutar cuando el contenido cambie (para SPAs)
const observer = new MutationObserver((mutations) => {
  const hasNewForms = mutations.some((mutation) =>
    Array.from(mutation.addedNodes).some(
      (node) => node instanceof HTMLElement && (node.tagName === 'FORM' || node.querySelector('form'))
    )
  );

  if (hasNewForms) {
    monitorForms();
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

console.log('[G8keeper] Auto-capture content script loaded');
