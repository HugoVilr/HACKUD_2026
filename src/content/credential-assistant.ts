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

function showFloatingToast(
  message: string,
  tone: "success" | "info" | "autofill" = "success",
  durationMs = 3000
): void {
  const toast = document.createElement("div");
  toast.className = `g8keeper-floating-toast g8keeper-floating-toast--${tone}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("g8keeper-floating-toast--fade");
    setTimeout(() => toast.remove(), 320);
  }, durationMs);
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
  // Buscar campo de confirmación de password (búsqueda manual case-insensitive)
  const passwordFields = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="password"]'));
  
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
    return true;
  }

  // Si hay más de un campo de password, probablemente sea signup
  if (passwordFields.length >= 2) {
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
    return true;
  }

  // Analizar texto del botón submit (soporte español)
  const submitButton = form.querySelector<HTMLButtonElement>(
    'button[type="submit"], input[type="submit"], button:not([type])'
  );
  const buttonText = submitButton?.textContent?.toLowerCase() || submitButton?.value.toLowerCase() || '';
  if (buttonText.match(/sign\s*up|register|create\s*account|join|crear\s*cuenta|registr|unirse/)) {
    return true;
  }

  // Analizar URL (soporte español)
  const url = window.location.href.toLowerCase();
  if (url.match(/\/signup|\/register|\/join|\/create-account|\/crear-cuenta|\/registro/)) {
    return true;
  }

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
    
    if (passwordFields.length === 0) {
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
    
    const unlocked = response?.ok && response?.data?.hasVault && !response?.data?.locked;

    return unlocked;
  } catch (error) {
    console.error('[G8keeper] Error checking vault status:', error);
    return false;
  }
}

async function openUnlockPopupForSignup(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: 'UI_OPEN_POPUP',
      payload: { source: 'signup' },
    });
  } catch (error) {
    console.error('[G8keeper] Error opening unlock popup:', error);
  }
}

async function waitForVaultUnlock(maxWaitMs = 60_000): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxWaitMs) {
    const unlocked = await isVaultUnlocked();
    if (unlocked) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
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
    <div class="g8keeper-toast">
      <div class="g8keeper-toast-row">
        <span class="g8keeper-toast-icon">🔐</span>
        <div class="g8keeper-toast-body">
          <strong class="g8keeper-toast-title">G8keeper detectó un formulario de registro</strong>
          <p class="g8keeper-toast-text">¿Quieres crear una contraseña segura desde el vault?</p>
          <div class="g8keeper-toast-actions">
            <button id="g8keeper-accept" class="g8keeper-toast-btn g8keeper-toast-btn--primary">Abrir Vault</button>
            <button id="g8keeper-dismiss" class="g8keeper-toast-btn g8keeper-toast-btn--ghost">Ignorar</button>
          </div>
        </div>
        <button id="g8keeper-close" class="g8keeper-toast-close">×</button>
      </div>
    </div>
  `;

  document.body.appendChild(notification);

  // Event listeners
  const acceptBtn = notification.querySelector('#g8keeper-accept');
  const dismissBtn = notification.querySelector('#g8keeper-dismiss');
  const closeBtn = notification.querySelector('#g8keeper-close');

  const remove = () => notification.remove();

  acceptBtn?.addEventListener('click', async () => {
    // Regla UX: si acepta crear contraseña, cerramos el aviso inmediatamente.
    remove();

    const acceptButton = acceptBtn as HTMLButtonElement;
    acceptButton.disabled = true;
    acceptButton.textContent = 'Procesando...';

    const unlocked = await isVaultUnlocked();
    if (!unlocked) {
      await openUnlockPopupForSignup();

      const unlockedAfterPopup = await waitForVaultUnlock(60_000);
      if (!unlockedAfterPopup) {
        const hint = document.createElement('div');
        hint.innerHTML = `
          <div style="
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #1f4f93;
            color: #bbd6ff;
            padding: 12px 16px;
            border-radius: 8px;
            border: 1px solid rgba(187, 214, 255, 0.4);
            box-shadow: 0 8px 20px rgba(0,0,0,0.35);
            z-index: 999999;
            font-family: 'Roboto Mono', 'IBM Plex Mono', 'Fira Code', monospace;
            font-size: 12px;
          ">
            No se pudo desbloquear a tiempo. Intentalo de nuevo.
          </div>
        `;
        document.body.appendChild(hint);
        setTimeout(() => hint.remove(), 3000);
        acceptButton.disabled = false;
        acceptButton.textContent = 'Abrir Vault';
        return;
      }
    }

    // Mostrar modal de creación dentro de la página
    showCreateEntryModal(form);
  });

  dismissBtn?.addEventListener('click', remove);
  closeBtn?.addEventListener('click', remove);

  // Auto-dismiss después de 15 segundos
  setTimeout(remove, 15000);
}

/**
 * Mostrar modal de creación de entrada dentro de la página
 */
function showCreateEntryModal(form: HTMLFormElement): void {
  // Detectar username actual del formulario para pre-rellenar
  const detected = detectForms().find(f => f.form === form);
  const currentUsername = detected?.usernameField?.value || '';
  
  // Crear overlay modal
  const modal = document.createElement('div');
  modal.id = 'g8keeper-create-modal';
  modal.innerHTML = `
    <div id="g8keeper-modal-backdrop"></div>
    <div id="g8keeper-modal-content">
      <div class="g8keeper-modal-header">
        <h2 class="g8keeper-modal-title">
          <span>🔐</span>
          Crear Credencial Segura
        </h2>
        <button class="g8keeper-btn-close" id="g8keeper-modal-close">×</button>
      </div>
      
      <div class="g8keeper-modal-body">
        <div class="g8keeper-security-note">
          <strong>Credencial segura recomendada</strong>
          <ul>
            <li>Mínimo 12 caracteres.</li>
            <li>Combina mayúsculas, minúsculas, números y símbolos.</li>
            <li>Evita secuencias y repeticiones como <code>aaa</code> o <code>123</code>.</li>
          </ul>
        </div>

        <div class="g8keeper-form-group">
          <label class="g8keeper-form-label">Título</label>
          <input 
            type="text" 
            class="g8keeper-form-input" 
            id="g8keeper-input-title"
            placeholder="Ej: ${window.location.hostname}"
            value="${window.location.hostname}"
          />
          <div class="g8keeper-hint">Nombre para identificar esta cuenta</div>
        </div>
        
        <div class="g8keeper-form-group">
          <label class="g8keeper-form-label">Usuario / Email</label>
          <input 
            type="text" 
            class="g8keeper-form-input" 
            id="g8keeper-input-username"
            placeholder="tu-email@ejemplo.com"
            value="${currentUsername}"
          />
        </div>
        
        <div class="g8keeper-form-group">
          <label class="g8keeper-form-label">Contraseña</label>
          <div class="g8keeper-password-group">
            <input 
              type="text" 
              class="g8keeper-form-input" 
              id="g8keeper-input-password"
              placeholder="Genera o escribe una contraseña segura (mín. 12 caracteres)"
            />
            <button class="g8keeper-btn-generate" id="g8keeper-btn-generate">
              🎲 Generar
            </button>
          </div>
          <div class="g8keeper-hint">Mínimo 12 caracteres. Click en Generar para 20 caracteres aleatorios</div>
        </div>
        
        <div id="g8keeper-modal-error" class="g8keeper-error g8keeper-hidden"></div>
      </div>
      
      <div class="g8keeper-modal-footer">
        <button class="g8keeper-btn g8keeper-btn-secondary" id="g8keeper-btn-cancel">
          Cancelar
        </button>
        <button class="g8keeper-btn g8keeper-btn-primary" id="g8keeper-btn-save" disabled>
          Guardar y Usar
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Referencias a elementos
  const titleInput = modal.querySelector<HTMLInputElement>('#g8keeper-input-title')!;
  const usernameInput = modal.querySelector<HTMLInputElement>('#g8keeper-input-username')!;
  const passwordInput = modal.querySelector<HTMLInputElement>('#g8keeper-input-password')!;
  const generateBtn = modal.querySelector<HTMLButtonElement>('#g8keeper-btn-generate')!;
  const saveBtn = modal.querySelector<HTMLButtonElement>('#g8keeper-btn-save')!;
  const cancelBtn = modal.querySelector<HTMLButtonElement>('#g8keeper-btn-cancel')!;
  const closeBtn = modal.querySelector<HTMLButtonElement>('#g8keeper-modal-close')!;
  const errorDiv = modal.querySelector<HTMLDivElement>('#g8keeper-modal-error')!;
  const backdrop = modal.querySelector<HTMLDivElement>('#g8keeper-modal-backdrop')!;
  
  // Función para cerrar modal
  const closeModal = () => {
    modal.remove();
  };
  
  // Validar formulario
  const validateForm = () => {
    const hasTitle = titleInput.value.trim().length > 0;
    const hasUsername = usernameInput.value.trim().length > 0;
    const password = passwordInput.value;
    const hasValidPassword = password.length >= 12; // Mínimo 12 caracteres
    
    // Mostrar error si hay contraseña pero es muy corta
    if (password.length > 0 && password.length < 12) {
      errorDiv.textContent = 'La contraseña debe tener al menos 12 caracteres';
      errorDiv.classList.remove('g8keeper-hidden');
    } else {
      errorDiv.classList.add('g8keeper-hidden');
    }
    
    saveBtn.disabled = !(hasTitle && hasUsername && hasValidPassword);
  };
  
  // Event listeners
  titleInput.addEventListener('input', validateForm);
  usernameInput.addEventListener('input', validateForm);
  passwordInput.addEventListener('input', validateForm);
  
  generateBtn.addEventListener('click', async () => {
    generateBtn.disabled = true;
    generateBtn.textContent = '⏳ Generando...';
    
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GENERATE_PASSWORD',
        payload: {
          config: {
            length: 20,
            lower: true,
            upper: true,
            digits: true,
            symbols: true,
            avoidAmbiguous: true
          }
        }
      });
      
      if (response.ok) {
        passwordInput.value = response.data.password;
        validateForm();
      } else {
        errorDiv.textContent = 'Error generando contraseña: ' + response.error?.message;
        errorDiv.classList.remove('g8keeper-hidden');
      }
    } catch (error) {
      console.error('[G8keeper] Error generating password:', error);
      errorDiv.textContent = 'Error generando contraseña';
      errorDiv.classList.remove('g8keeper-hidden');
    } finally {
      generateBtn.disabled = false;
      generateBtn.textContent = '🎲 Generar';
    }
  });
  
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando...';
    errorDiv.classList.add('g8keeper-hidden');
    
    const title = titleInput.value.trim();
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'ENTRY_ADD',
        payload: {
          entry: {
            title,
            username,
            password
          }
        }
      });
      
      if (response.ok) {
        // Rellenar formulario automáticamente
        if (detected) {
          if (detected.usernameField) {
            detected.usernameField.value = username;
            detected.usernameField.dispatchEvent(new Event('input', { bubbles: true }));
            detected.usernameField.dispatchEvent(new Event('change', { bubbles: true }));
          }
          
          if (detected.passwordField) {
            detected.passwordField.value = password;
            detected.passwordField.dispatchEvent(new Event('input', { bubbles: true }));
            detected.passwordField.dispatchEvent(new Event('change', { bubbles: true }));
          }
          
          // Si hay campo de confirmación de password, rellenarlo también
          const passwordFields = form.querySelectorAll<HTMLInputElement>('input[type="password"]');
          passwordFields.forEach(field => {
            field.value = password;
            field.dispatchEvent(new Event('input', { bubbles: true }));
            field.dispatchEvent(new Event('change', { bubbles: true }));
          });
        }
        
        // Mostrar confirmación y cerrar modal
        closeModal();
        showFloatingToast("✓ Credenciales guardadas y completadas en el formulario", "success", 4000);
        
      } else {
        errorDiv.textContent = 'Error guardando: ' + (response.error?.message || 'Error desconocido');
        errorDiv.classList.remove('g8keeper-hidden');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Guardar y Usar';
      }
    } catch (error) {
      console.error('[G8keeper] Error saving entry:', error);
      errorDiv.textContent = 'Error guardando la entrada';
      errorDiv.classList.remove('g8keeper-hidden');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Guardar y Usar';
    }
  });
  
  cancelBtn.addEventListener('click', closeModal);
  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', closeModal);
  
  // Generar contraseña automáticamente al abrir
  setTimeout(() => generateBtn.click(), 100);
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
    <div class="g8keeper-save-toast">
      <div class="g8keeper-save-toast__row">
        <span class="g8keeper-save-toast__icon">✅</span>
        <div class="g8keeper-save-toast__body">
          <strong class="g8keeper-save-toast__title">¿Guardar en G8keeper?</strong>
          <p class="g8keeper-save-toast__text">Usuario: ${escapeHtmlContent(formData.username)}</p>
          <div class="g8keeper-save-toast__actions">
            <button id="g8keeper-save-accept" class="g8keeper-save-toast__btn g8keeper-save-toast__btn--primary">Guardar</button>
            <button id="g8keeper-save-dismiss" class="g8keeper-save-toast__btn g8keeper-save-toast__btn--ghost">No</button>
          </div>
        </div>
        <button id="g8keeper-save-close" class="g8keeper-save-toast__close">×</button>
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

      showFloatingToast('✅ Guardado en vault');
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
  const detected = detectForms();

  for (const { form, isSignup, ...rest } of detected) {
    // Flujo 1: Sugerir crear desde vault si es signup
    if (isSignup) {
      showSignupSuggestion(form);
    }

    // Flujo 2: Capturar después de submit exitoso
    if (form.dataset.g8keeperSubmitBound === 'true') {
      continue;
    }
    form.dataset.g8keeperSubmitBound = 'true';

    form.addEventListener('submit', async () => {
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
  document.addEventListener('DOMContentLoaded', () => {
    monitorForms();
  });
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

    showFloatingToast('✓ Credenciales completadas automáticamente', 'autofill');

    sendResponse({ ok: true });
  }
});
