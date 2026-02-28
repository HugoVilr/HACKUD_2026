# Auto-Capture de Credenciales

## 🎯 Descripción

Feature que detecta automáticamente formularios de registro y login en páginas web, sugiriendo al usuario crear contraseñas seguras desde el vault o guardar credenciales después de registrarse.

## ✨ Funcionalidades

### 1. **Detección Proactiva de Signup con Modal In-Page**
Cuando el usuario visita una página con un formulario de registro:

**Comportamiento:**
- ✅ Detecta automáticamente formularios de signup
- ✅ Verifica que el vault esté desbloqueado
- ✅ Muestra notification azul sugiriendo crear desde vault
- ✅ Si usuario acepta → abre **modal dentro de la página** (no popup extensión)
- ✅ Modal pre-rellena título y username del formulario
- ✅ Genera contraseña segura automáticamente (20 caracteres)
- ✅ Al guardar → autorellena TODOS los campos del formulario
- ✅ Usuario solo hace click en "Enviar" para crear cuenta

**Flujo Natural:**
```
1. Usuario en página de registro (ej: PCComponentes, Casa del Libro)
2. Aparece notificación azul: "🔐 ¿Crear contraseña segura?"
3. Click en "Abrir Vault"
4. Modal se abre EN LA MISMA PÁGINA (sin cambiar de pestaña)
5. Contraseña ya generada automáticamente
6. Usuario revisa/edita username si necesario
7. Click en "Guardar y Usar"
8. Formulario se autorellena con credenciales seguras
9. Usuario hace click en botón de registro de la web
10. ¡Cuenta creada con contraseña segura!
```

**Heurísticas de detección de signup:**
- Campo "confirm password" (soporta: confirm, repeat, repetir, confirmar)
- Búsqueda en: name, id, placeholder, aria-label (case-insensitive)
- Múltiples campos de password (≥2)
- Campo "email" sin "username"
- Botón con texto: "sign up", "register", "create account", "crear cuenta", "registrarse"
- URL contiene: `/signup`, `/register`, `/join`, `/crear-cuenta`, `/registro`
- Soporte multiidioma (español e inglés)

### 2. **Captura Post-Registro (Flujo Pasivo)**
Cuando el usuario completa un formulario sin usar el vault:

**Comportamiento:**
- ✅ Detecta submit de formulario
- ✅ Espera 1.5s para verificar éxito (sin errores visibles)
- ✅ Captura username y password del formulario
- ✅ Muestra notification verde pidiendo guardar en vault
- ✅ Si usuario acepta → guarda automáticamente

**Nota:** Este flujo es para usuarios que prefieren crear cuentas manualmente. El flujo recomendado es el proactivo (modal in-page) para generar contraseñas seguras desde el inicio.

## 🔒 Consideraciones de Seguridad

### **Protecciones implementadas:**
1. **Solo con vault desbloqueado** - No funciona si vault está bloqueado
2. **Confirmación explícita** - Usuario debe aceptar antes de capturar contraseñas
3. **Sin logging** - No se registran passwords en console
4. **Auto-dismiss** - Notifications desaparecen tras 15 segundos

### **Limitaciones conocidas:**
- ⚠️ Content script tiene acceso a inputs de password (después de submit)
- ⚠️ No detecta formularios dinámicos complejos (solo MutationObserver básico)
- ⚠️ Heurísticas pueden fallar en sitios con formularios no-estándar

## 📂 Archivos Modificados/Creados

### **Nuevo:**
- `src/content/autofill.ts` - Content script principal (inyectado en todas las páginas)

### **Modificados:**
- `manifest.json` - Añadido content_scripts, permissions (activeTab, scripting), host_permissions
- `src/shared/messages.ts` - Añadido `OPEN_POPUP_FOR_SIGNUP`, `AUTOFILL_CREDENTIALS`, `REQUEST_AUTOFILL` message types
- `src/background/session.ts` - Handler para verificar vault desbloqueado y REQUEST_AUTOFILL
- `src/background/sw.ts` - Whitelist de mensajes permitidos desde content scripts (VAULT_STATUS, OPEN_POPUP_FOR_SIGNUP)
- `src/content/autofill.ts` - Heurísticas multiidioma, modal in-page completo, autofill automático
- `package.json` - Script de build actualizado para compilar content script

## 🚀 Uso

### **Para el usuario:**

1. **Flujo proactivo con modal in-page (RECOMENDADO):**
   ```
   Usuario visita página de registro (ej: PCComponentes, Casa del Libro)
   → Aparece notification azul: "🔐 ¿Crear contraseña segura?"
   → Usuario click "Abrir Vault"
   → Modal se abre DENTRO DE LA PÁGINA (sin salir del sitio)
   → Contraseña segura ya generada (20 caracteres)
   → Usuario revisa título y username (pre-rellenados)
   → Usuario click "Guardar y Usar"
   → Formulario se autorellena con credenciales seguras
   → Aparece notificación verde de confirmación
   → Usuario hace click en botón "Registrarse" de la web
   → ¡Cuenta creada con contraseña segura!
   ```

2. **Flujo reactivo post-submit (pasivo):**
   ```
   Usuario crea cuenta manualmente en sitio web
   → Submit exitoso detectado
   → Aparece notification verde: "¿Guardar en vault?"
   → Usuario click "Guardar"
   → Credencial guardada automáticamente en vault
   ```

### **Para desarrollo:**

```bash
# Compilar extensión con content script
npm run build

# Cargar en Chrome
# 1. chrome://extensions/
# 2. Activar "Developer mode"
# 3. "Load unpacked" → seleccionar carpeta del proyecto
```

## 🧪 Testing

### **Sitios de prueba recomendados:**
- **Signup forms:** GitHub, GitLab, Reddit signup pages
- **Login forms:** Gmail, Twitter, Facebook login

### **Casos de prueba:**

1. **Caso 1: Signup detectado correctamente**
   - Ir a página de registro
   - Verificar notification azul aparece
   - Click "Abrir Vault"
   - Verificar que popup se abre

2. **Caso 2: Captura post-submit**
   - Crear cuenta en sitio de prueba
   - Verificar notification verde aparece
   - Click "Guardar"
   - Verificar entrada guardada en vault

3. **Caso 3: Vault bloqueado**
   - Bloquear vault
   - Ir a página signup
   - Verificar que NO aparece notification

4. **Caso 4: Formularios dinámicos (SPA)**
   - Ir a SPA (e.g., React app)
   - Navegar a /signup
   - Verificar detección funciona

## 📊 Estadísticas de Build

```
src/content/autofill.js  9.8kb
```

## 🔄 Flujo de Mensajes

```
[Content Script]
    ↓
    chrome.runtime.sendMessage({ type: 'VAULT_STATUS' })
    ↓
[Background Service Worker]
    ↓
    Verifica session.unlocked
    ↓
    Retorna { ok: true, data: { locked: false } }
    ↓
[Content Script]
    ↓
    Si unlocked → Muestra notification
```

## 🎨 UI/UX

### **Notification de Signup (Azul):**
- 🔐 Icono de vault
- Título: "G8keeper detectó un formulario de registro"
- Mensaje: "¿Quieres crear una contraseña segura desde el vault?"
- Botones: "Abrir Vault" (blanco), "Ignorar" (transparente)
- Auto-dismiss: 15 segundos

### **Notification de Save (Verde):**
- ✅ Icono de checkmark
- Título: "¿Guardar en G8keeper?"
- Mensaje: "Usuario: {username}"
- Botones: "Guardar" (blanco), "No" (transparente)
- Auto-dismiss: 15 segundos

## 🐛 Known Issues

1. **MV3 Limitation:** No se puede abrir popup programáticamente desde content script
   - Workaround actual: Solo verificamos vault desbloqueado
   - Solución futura: Usar chrome.action.openPopup() con user gesture

2. **False positives:** Algunos formularios no-signup pueden detectarse como signup
   - Mitigación: Usuario puede simplemente ignorar notification

3. **Timing de captura:** 1.5s delay puede no ser suficiente en conexiones lentas
   - Mejora futura: Detectar navigation events en lugar de timeout

## 📝 TODO / Mejoras Futuras

- [ ] Detectar cambios de URL (history API) para SPAs avanzadas
- [ ] Añadir opción "No preguntar más en este sitio"
- [ ] Integrar con chrome.action.setBadgeText() para indicar formularios detectados
- [ ] Añadir analytics de detección (cuántos forms detectados, guardados, ignorados)
- [ ] Mejorar heurísticas con ML (entrenar modelo en dataset de forms)
- [ ] Soportar autofill de passwords existentes en login forms

## 📚 Referencias

- [Chrome Extension Content Scripts](https://developer.chrome.com/docs/extensions/mv3/content_scripts/)
- [Chrome Runtime Messaging](https://developer.chrome.com/docs/extensions/mv3/messaging/)
- [Form Detection Best Practices](https://www.w3.org/WAI/WCAG21/Understanding/identify-input-purpose.html)

---

**Branch:** `feature/auto-capture-credentials`  
**Status:** ✅ Compilación exitosa, listo para testing  
**Last Updated:** 2026-02-28
