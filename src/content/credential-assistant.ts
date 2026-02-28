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

const G8_SIGNUP_SUGGESTION_STYLE = String.raw`
  <style>
    #g8keeper-signup-notification .g8keeper-toast {
      position: fixed;
      top: 20px;
      right: 20px;
      width: min(360px, calc(100vw - 24px));
      padding: 14px 16px;
      border-radius: 10px;
      border: 1px solid rgba(154, 248, 157, 0.45);
      color: #c3f6c4;
      background:
        linear-gradient(180deg, rgba(15, 32, 15, 0.95) 0%, rgba(8, 17, 8, 0.98) 100%);
      box-shadow:
        inset 0 0 0 1px rgba(154, 248, 157, 0.08),
        0 14px 34px rgba(0, 0, 0, 0.45);
      z-index: 999999;
      font-family: "Roboto Mono", "IBM Plex Mono", "Fira Code", "SFMono-Regular", Consolas, monospace;
      font-size: 13px;
      animation: g8keeper-slide-in 160ms ease-out;
    }

    #g8keeper-signup-notification .g8keeper-toast-row {
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }

    #g8keeper-signup-notification .g8keeper-toast-icon {
      font-size: 20px;
      line-height: 1;
      filter: drop-shadow(0 0 6px rgba(154, 248, 157, 0.35));
    }

    #g8keeper-signup-notification .g8keeper-toast-body {
      flex: 1;
      min-width: 0;
    }

    #g8keeper-signup-notification .g8keeper-toast-title {
      display: block;
      margin-bottom: 4px;
      color: #cefccd;
      font-size: 13px;
    }

    #g8keeper-signup-notification .g8keeper-toast-text {
      margin: 0 0 10px;
      color: #9bc89f;
      line-height: 1.35;
      font-size: 12px;
    }

    #g8keeper-signup-notification .g8keeper-toast-actions {
      display: flex;
      gap: 8px;
    }

    #g8keeper-signup-notification .g8keeper-toast-btn {
      border-radius: 7px;
      border: 1px solid rgba(154, 248, 157, 0.4);
      padding: 6px 10px;
      font-size: 12px;
      font-family: inherit;
      cursor: pointer;
    }

    #g8keeper-signup-notification .g8keeper-toast-btn--primary {
      background: rgba(154, 248, 157, 0.18);
      color: #cefccd;
      border-color: rgba(206, 252, 205, 0.6);
    }

    #g8keeper-signup-notification .g8keeper-toast-btn--primary:hover {
      background: rgba(154, 248, 157, 0.28);
    }

    #g8keeper-signup-notification .g8keeper-toast-btn--ghost {
      background: transparent;
      color: #9af89d;
    }

    #g8keeper-signup-notification .g8keeper-toast-btn--ghost:hover {
      background: rgba(154, 248, 157, 0.1);
      color: #cefccd;
    }

    #g8keeper-signup-notification .g8keeper-toast-close {
      border: none;
      background: transparent;
      color: #9bc89f;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      padding: 0 4px;
    }

    #g8keeper-signup-notification .g8keeper-toast-close:hover {
      color: #cefccd;
    }

    @keyframes g8keeper-slide-in {
      from {
        transform: translateX(30px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
  </style>
`;

const G8_CREATE_MODAL_STYLE = String.raw`
  <style>
    #g8keeper-modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.72);
      backdrop-filter: blur(2px);
      z-index: 999998;
      animation: g8keeper-fade-in 140ms ease-out;
    }

    #g8keeper-modal-content {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: min(520px, calc(100vw - 24px));
      max-height: min(88vh, 760px);
      overflow-y: auto;
      border-radius: 12px;
      border: 1px solid rgba(154, 248, 157, 0.38);
      background:
        radial-gradient(circle at 14% 12%, #112511 0%, transparent 40%),
        linear-gradient(180deg, rgba(15, 32, 15, 0.95) 0%, rgba(8, 17, 8, 0.98) 100%);
      color: #c3f6c4;
      box-shadow:
        inset 0 0 0 1px rgba(154, 248, 157, 0.08),
        0 24px 58px rgba(0, 0, 0, 0.55);
      z-index: 999999;
      font-family: "Roboto Mono", "IBM Plex Mono", "Fira Code", "SFMono-Regular", Consolas, monospace;
      animation: g8keeper-modal-up 180ms ease-out;
    }

    @keyframes g8keeper-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes g8keeper-modal-up {
      from {
        transform: translate(-50%, -46%);
        opacity: 0;
      }
      to {
        transform: translate(-50%, -50%);
        opacity: 1;
      }
    }

    #g8keeper-modal-content .g8keeper-modal-header {
      padding: 18px 18px 14px;
      border-bottom: 1px solid rgba(154, 248, 157, 0.25);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    #g8keeper-modal-content .g8keeper-modal-title {
      margin: 0;
      font-size: 17px;
      font-weight: 600;
      color: #cefccd;
      display: flex;
      align-items: center;
      gap: 8px;
      text-shadow: 0 0 8px rgba(154, 248, 157, 0.25);
    }

    #g8keeper-modal-content .g8keeper-modal-body {
      padding: 16px 18px;
    }

    #g8keeper-modal-content .g8keeper-security-note {
      margin: 0 0 12px;
      padding: 10px 12px;
      border: 1px solid rgba(154, 248, 157, 0.3);
      border-radius: 8px;
      background: rgba(154, 248, 157, 0.08);
    }

    #g8keeper-modal-content .g8keeper-security-note strong {
      display: block;
      margin-bottom: 6px;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #cefccd;
    }

    #g8keeper-modal-content .g8keeper-security-note ul {
      margin: 0;
      padding-left: 18px;
      display: grid;
      gap: 4px;
      font-size: 12px;
      color: #9bc89f;
      line-height: 1.35;
    }

    #g8keeper-modal-content .g8keeper-security-note code {
      padding: 1px 4px;
      border-radius: 4px;
      border: 1px solid rgba(154, 248, 157, 0.28);
      background: rgba(3, 12, 3, 0.9);
      color: #cefccd;
    }

    #g8keeper-modal-content .g8keeper-form-group {
      margin-bottom: 12px;
    }

    #g8keeper-modal-content .g8keeper-form-label {
      display: block;
      margin-bottom: 6px;
      font-weight: 500;
      font-size: 12px;
      color: #9bc89f;
    }

    #g8keeper-modal-content .g8keeper-form-input {
      width: 100%;
      padding: 9px 10px;
      border: 1px solid rgba(154, 248, 157, 0.35);
      border-radius: 8px;
      font-size: 13px;
      font-family: inherit;
      box-sizing: border-box;
      color: #c3f6c4;
      background: rgba(3, 12, 3, 0.86);
      transition: border-color 120ms ease, box-shadow 120ms ease;
    }

    #g8keeper-modal-content .g8keeper-form-input::placeholder {
      color: #6d8f6f;
    }

    #g8keeper-modal-content .g8keeper-form-input:focus {
      outline: 1px solid rgba(206, 252, 205, 0.5);
      border-color: rgba(206, 252, 205, 0.7);
      box-shadow: 0 0 0 2px rgba(154, 248, 157, 0.14);
    }

    #g8keeper-modal-content .g8keeper-password-group {
      display: flex;
      gap: 8px;
      align-items: stretch;
    }

    #g8keeper-modal-content .g8keeper-password-group input {
      flex: 1;
    }

    #g8keeper-modal-content .g8keeper-btn-generate {
      padding: 9px 12px;
      border-radius: 8px;
      border: 1px solid rgba(154, 248, 157, 0.5);
      background: rgba(154, 248, 157, 0.16);
      color: #cefccd;
      cursor: pointer;
      font-weight: 500;
      font-size: 12px;
      font-family: inherit;
      white-space: nowrap;
    }

    #g8keeper-modal-content .g8keeper-btn-generate:hover {
      background: rgba(154, 248, 157, 0.25);
    }

    #g8keeper-modal-content .g8keeper-btn-generate:disabled {
      opacity: 0.65;
      cursor: progress;
    }

    #g8keeper-modal-content .g8keeper-modal-footer {
      padding: 14px 18px;
      border-top: 1px solid rgba(154, 248, 157, 0.25);
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }

    #g8keeper-modal-content .g8keeper-btn {
      padding: 8px 12px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 12px;
      font-family: inherit;
      border: 1px solid rgba(154, 248, 157, 0.35);
    }

    #g8keeper-modal-content .g8keeper-btn-primary {
      background: rgba(154, 248, 157, 0.18);
      border-color: rgba(206, 252, 205, 0.6);
      color: #cefccd;
    }

    #g8keeper-modal-content .g8keeper-btn-primary:hover {
      background: rgba(154, 248, 157, 0.28);
    }

    #g8keeper-modal-content .g8keeper-btn-primary:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    #g8keeper-modal-content .g8keeper-btn-secondary {
      background: transparent;
      color: #9af89d;
    }

    #g8keeper-modal-content .g8keeper-btn-secondary:hover {
      background: rgba(154, 248, 157, 0.1);
      color: #cefccd;
    }

    #g8keeper-modal-content .g8keeper-btn-close {
      background: transparent;
      border: none;
      color: #9bc89f;
      cursor: pointer;
      font-size: 22px;
      line-height: 1;
      width: 30px;
      height: 30px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    #g8keeper-modal-content .g8keeper-btn-close:hover {
      background: rgba(154, 248, 157, 0.12);
      color: #cefccd;
    }

    #g8keeper-modal-content .g8keeper-error {
      color: #ffc1c1;
      background: #6f2a2a;
      border: 1px solid rgba(255, 127, 127, 0.5);
      font-size: 12px;
      margin-top: 8px;
      border-radius: 8px;
      padding: 8px 10px;
    }

    #g8keeper-modal-content .g8keeper-hint {
      color: #6d8f6f;
      font-size: 11px;
      margin-top: 4px;
      line-height: 1.3;
    }

    #g8keeper-modal-content::-webkit-scrollbar {
      width: 8px;
    }

    #g8keeper-modal-content::-webkit-scrollbar-track {
      background: rgba(154, 248, 157, 0.06);
    }

    #g8keeper-modal-content::-webkit-scrollbar-thumb {
      background: rgba(154, 248, 157, 0.34);
      border-radius: 999px;
    }
  </style>
`;

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
    ${G8_SIGNUP_SUGGESTION_STYLE}
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
    remove();
    
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
    ${G8_CREATE_MODAL_STYLE}
    
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
        
        <div id="g8keeper-modal-error" class="g8keeper-error" style="display: none;"></div>
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
      errorDiv.style.display = 'block';
    } else {
      errorDiv.style.display = 'none';
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
        errorDiv.style.display = 'block';
      }
    } catch (error) {
      console.error('[G8keeper] Error generating password:', error);
      errorDiv.textContent = 'Error generando contraseña';
      errorDiv.style.display = 'block';
    } finally {
      generateBtn.disabled = false;
      generateBtn.textContent = '🎲 Generar';
    }
  });
  
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando...';
    errorDiv.style.display = 'none';
    
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
        
        // Mostrar notificación de éxito
        const successNotification = document.createElement('div');
        successNotification.innerHTML = `
          <div style="
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #4caf50;
            color: white;
            padding: 16px 24px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 999999;
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 14px;
            font-weight: 500;
            animation: slideIn 0.3s ease-out;
          ">
            ✓ Credenciales guardadas y completadas en el formulario
          </div>
          <style>
            @keyframes slideIn {
              from { transform: translateX(100%); opacity: 0; }
              to { transform: translateX(0); opacity: 1; }
            }
          </style>
        `;
        document.body.appendChild(successNotification);
        
        setTimeout(() => {
          successNotification.style.transition = 'opacity 0.3s';
          successNotification.style.opacity = '0';
          setTimeout(() => successNotification.remove(), 300);
        }, 4000);
        
      } else {
        errorDiv.textContent = 'Error guardando: ' + (response.error?.message || 'Error desconocido');
        errorDiv.style.display = 'block';
        saveBtn.disabled = false;
        saveBtn.textContent = 'Guardar y Usar';
      }
    } catch (error) {
      console.error('[G8keeper] Error saving entry:', error);
      errorDiv.textContent = 'Error guardando la entrada';
      errorDiv.style.display = 'block';
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
  if (!unlocked) {
    return; // Solo funciona con vault desbloqueado
  }

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
