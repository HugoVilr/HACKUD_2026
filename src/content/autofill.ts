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
    <style>
      #g8keeper-modal-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        z-index: 999998;
        animation: g8keeper-fadeIn 0.2s ease-out;
      }
      
      #g8keeper-modal-content {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        border-radius: 12px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        z-index: 999999;
        width: 90%;
        max-width: 480px;
        max-height: 90vh;
        overflow-y: auto;
        animation: g8keeper-slideUp 0.3s ease-out;
        font-family: system-ui, -apple-system, sans-serif;
      }
      
      @keyframes g8keeper-fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      
      @keyframes g8keeper-slideUp {
        from { 
          transform: translate(-50%, -40%);
          opacity: 0;
        }
        to { 
          transform: translate(-50%, -50%);
          opacity: 1;
        }
      }
      
      .g8keeper-modal-header {
        padding: 24px 24px 16px;
        border-bottom: 1px solid #e0e0e0;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      
      .g8keeper-modal-title {
        margin: 0;
        font-size: 20px;
        font-weight: 600;
        color: #1976d2;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      
      .g8keeper-modal-body {
        padding: 24px;
      }
      
      .g8keeper-form-group {
        margin-bottom: 20px;
      }
      
      .g8keeper-form-label {
        display: block;
        margin-bottom: 8px;
        font-weight: 500;
        font-size: 14px;
        color: #333;
      }
      
      .g8keeper-form-input {
        width: 100%;
        padding: 10px 12px;
        border: 2px solid #e0e0e0;
        border-radius: 6px;
        font-size: 14px;
        font-family: inherit;
        box-sizing: border-box;
        transition: border-color 0.2s;
      }
      
      .g8keeper-form-input:focus {
        outline: none;
        border-color: #1976d2;
      }
      
      .g8keeper-password-group {
        display: flex;
        gap: 8px;
      }
      
      .g8keeper-password-group input {
        flex: 1;
      }
      
      .g8keeper-btn-generate {
        padding: 10px 16px;
        background: #4caf50;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 500;
        font-size: 13px;
        white-space: nowrap;
        transition: background 0.2s;
      }
      
      .g8keeper-btn-generate:hover {
        background: #45a049;
      }
      
      .g8keeper-modal-footer {
        padding: 16px 24px;
        border-top: 1px solid #e0e0e0;
        display: flex;
        gap: 12px;
        justify-content: flex-end;
      }
      
      .g8keeper-btn {
        padding: 10px 20px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 500;
        font-size: 14px;
        transition: all 0.2s;
      }
      
      .g8keeper-btn-primary {
        background: #1976d2;
        color: white;
      }
      
      .g8keeper-btn-primary:hover {
        background: #1565c0;
      }
      
      .g8keeper-btn-primary:disabled {
        background: #ccc;
        cursor: not-allowed;
      }
      
      .g8keeper-btn-secondary {
        background: transparent;
        color: #666;
        border: 1px solid #ddd;
      }
      
      .g8keeper-btn-secondary:hover {
        background: #f5f5f5;
      }
      
      .g8keeper-btn-close {
        background: transparent;
        border: none;
        color: #666;
        cursor: pointer;
        font-size: 24px;
        line-height: 1;
        padding: 0;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .g8keeper-btn-close:hover {
        background: #f5f5f5;
      }
      
      .g8keeper-error {
        color: #d32f2f;
        font-size: 13px;
        margin-top: 8px;
      }
      
      .g8keeper-hint {
        color: #666;
        font-size: 12px;
        margin-top: 4px;
      }
    </style>
    
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
