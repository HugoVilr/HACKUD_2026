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
  console.log('[G8keeper] Checking if form is signup:', form);
  
  // Buscar campo de confirmación de password (búsqueda manual case-insensitive)
  const passwordFields = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="password"]'));
  console.log('[G8keeper] Found password fields:', passwordFields.length);
  
  // Buscar confirm password field manualmente (case-insensitive)
  const confirmKeywords = ['confirm', 'repeat', 'repetir', 'confirmar'];
  const confirmPasswordField = passwordFields.find(field => {
    const name = (field.name || '').toLowerCase();
    const id = (field.id || '').toLowerCase();
    const placeholder = (field.placeholder || '').toLowerCase();
    const ariaLabel = (field.getAttribute('aria-label') || '').toLowerCase();
    
    return confirmKeywords.some(keyword => 
      name.includes(keyword) || 
      id.includes(keyword) || 
      placeholder.includes(keyword) || 
      ariaLabel.includes(keyword)
    );
  });
  
  if (confirmPasswordField) {
    console.log('[G8keeper] ✓ Detected confirm password field:', confirmPasswordField);
    return true;
  }

  // Si hay más de un campo de password, probablemente sea signup
  if (passwordFields.length >= 2) {
    console.log('[G8keeper] ✓ Multiple password fields detected (signup):', passwordFields.length);
    return true;
  }

  // Buscar campo de email sin username (común en signups)
  const allInputs = Array.from(form.querySelectorAll<HTMLInputElement>('input'));
  const emailField = allInputs.find(input => {
    const type = input.type.toLowerCase();
    const name = (input.name || '').toLowerCase();
    const id = (input.id || '').toLowerCase();
    return type === 'email' || name.includes('email') || id.includes('email');
  });
  
  const usernameField = allInputs.find(input => {
    const name = (input.name || '').toLowerCase();
    const id = (input.id || '').toLowerCase();
    return name.includes('username') || id.includes('username');
  });
  
  if (emailField && !usernameField) {
    console.log('[G8keeper] ✓ Email field without username (signup):', emailField);
    return true;
  }

  // Analizar texto del botón submit (soporte español)
  const submitButton = form.querySelector<HTMLButtonElement>(
    'button[type="submit"], input[type="submit"], button:not([type])'
  );
  const buttonText = submitButton?.textContent?.toLowerCase() || submitButton?.value.toLowerCase() || '';
  console.log('[G8keeper] Submit button text:', buttonText);
  if (buttonText.match(/sign\s*up|register|create\s*account|join|crear\s*cuenta|registr|unirse/)) {
    console.log('[G8keeper] ✓ Signup button text detected');
    return true;
  }

  // Analizar URL (soporte español)
  const url = window.location.href.toLowerCase();
  console.log('[G8keeper] Current URL:', url);
  if (url.match(/\/signup|\/register|\/join|\/create-account|\/crear-cuenta|\/registro/)) {
    console.log('[G8keeper] ✓ Signup URL pattern detected');
    return true;
  }

  console.log('[G8keeper] ✗ Not detected as signup form');
  return false;
}

/**
 * Detectar formularios de login/signup en la página
 */
function detectForms(): DetectedForm[] {
  const forms = Array.from(document.querySelectorAll<HTMLFormElement>('form'));
  console.log('[G8keeper] Scanning page, found forms:', forms.length);
  const detected: DetectedForm[] = [];

  for (const form of forms) {
    // Buscar campos de password
    const passwordFields = Array.from(
      form.querySelectorAll<HTMLInputElement>('input[type="password"]')
    );
    
    if (passwordFields.length === 0) {
      console.log('[G8keeper] Form has no password fields, skipping');
      continue;
    }

    // Buscar campo de username/email (búsqueda manual case-insensitive)
    const allInputs = Array.from(form.querySelectorAll<HTMLInputElement>('input'));
    const usernameField = allInputs.find(input => {
      const type = input.type.toLowerCase();
      const name = (input.name || '').toLowerCase();
      const id = (input.id || '').toLowerCase();
      
      return type === 'email' || 
        name.includes('user') || 
        name.includes('email') || 
        name.includes('nombre') ||
        name.includes('correo') ||
        id.includes('user') || 
        id.includes('email') || 
        id.includes('nombre') ||
        id.includes('correo');
    });

    const passwordField = passwordFields[0]; // Primer campo de password
    const isSignup = isSignupForm(form);
    
    console.log('[G8keeper] Form analysis:', { 
      hasPasswordFields: passwordFields.length,
      hasUsernameField: !!usernameField,
      isSignup 
    });

    detected.push({
      form,
      usernameField: usernameField || null,
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
    
    console.log('[G8keeper] Vault status:', response?.data);
    const unlocked = response?.ok && response?.data?.hasVault && !response?.data?.locked;
    console.log('[G8keeper] Vault unlocked?', unlocked);

    return unlocked;
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
  console.log('[G8keeper] monitorForms() called');
  const unlocked = await isVaultUnlocked();
  if (!unlocked) {
    console.log('[G8keeper] Vault is locked, skipping form monitoring');
    return; // Solo funciona con vault desbloqueado
  }

  const detected = detectForms();
  console.log('[G8keeper] Forms with password fields:', detected.length);

  for (const { form, isSignup, ...rest } of detected) {
    // Flujo 1: Sugerir crear desde vault si es signup
    if (isSignup) {
      console.log('[G8keeper] Showing signup suggestion for form');
      showSignupSuggestion(form);
    } else {
      console.log('[G8keeper] Form is login, not signup - skipping suggestion');
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
console.log('[G8keeper] Auto-capture content script initializing...', {
  readyState: document.readyState,
  url: window.location.href
});

if (document.readyState === 'loading') {
  console.log('[G8keeper] DOM still loading, waiting for DOMContentLoaded...');
  document.addEventListener('DOMContentLoaded', () => {
    console.log('[G8keeper] DOMContentLoaded event fired');
    monitorForms();
  });
} else {
  console.log('[G8keeper] DOM already ready, monitoring forms now...');
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
    console.log('[G8keeper] New forms detected via MutationObserver, re-monitoring...');
    monitorForms();
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

console.log('[G8keeper] MutationObserver initialized');

/**
 * Listener para autofill desde background
 * Cuando el usuario crea una entrada en el popup, background puede enviar las credenciales
 * para autorellenar el formulario actual
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'AUTOFILL_CREDENTIALS') {
    const { username, password } = message.payload;

    // Buscar formularios en la página
    const detected = detectForms();
    if (detected.length === 0) {
      sendResponse({ ok: false, error: 'No forms detected' });
      return;
    }

    // Usar el primer formulario detectado
    const { form, usernameField, passwordField } = detected[0];

    // Rellenar campos
    if (usernameField && username) {
      usernameField.value = username;
      usernameField.dispatchEvent(new Event('input', { bubbles: true }));
      usernameField.dispatchEvent(new Event('change', { bubbles: true }));
    }

    if (passwordField && password) {
      passwordField.value = password;
      passwordField.dispatchEvent(new Event('input', { bubbles: true }));
      passwordField.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Mostrar confirmación visual
    const notification = document.createElement('div');
    notification.innerHTML = `
      <div style="
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #10b981;
        color: white;
        padding: 16px 24px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 999999;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 14px;
        font-weight: 500;
        animation: slideIn 0.3s ease-out;
      ">
        ✓ Credenciales completadas automáticamente
      </div>
      <style>
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      </style>
    `;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.transition = 'opacity 0.3s';
      notification.style.opacity = '0';
      setTimeout(() => notification.remove(), 300);
    }, 3000);

    sendResponse({ ok: true });
  }
});

console.log('[G8keeper] Auto-capture content script loaded');
