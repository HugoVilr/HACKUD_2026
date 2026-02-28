# Auto-Capture de Credenciales

## 🎯 Descripción

Feature que detecta automáticamente formularios de registro y login en páginas web, sugiriendo al usuario crear contraseñas seguras desde el vault o guardar credenciales después de registrarse.

## ✨ Funcionalidades

### 1. **Detección Proactiva de Signup**
Cuando el usuario visita una página con un formulario de registro:

**Comportamiento:**
- ✅ Detecta automáticamente formularios de signup
- ✅ Verifica que el vault esté desbloqueado
- ✅ Muestra notification sugiriendo crear desde vault
- ✅ Si usuario acepta → abre popup para generar contraseña segura

**Heurísticas de detección de signup:**
- Campo "confirm password"
- Campo "email" sin "username"
- Botón con texto: "sign up", "register", "create account"
- URL contiene: `/signup`, `/register`, `/join`

### 2. **Captura Post-Registro**
Cuando el usuario completa un formulario sin usar el vault:

**Comportamiento:**
- ✅ Detecta submit de formulario
- ✅ Espera 1.5s para verificar éxito (sin errores visibles)
- ✅ Captura username y password del formulario
- ✅ Muestra notification pidiendo guardar en vault
- ✅ Si usuario acepta → guarda automáticamente

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
- `src/shared/messages.ts` - Añadido `OPEN_POPUP_FOR_SIGNUP` message type
- `src/background/session.ts` - Handler para verificar vault desbloqueado
- `package.json` - Script de build actualizado para compilar content script

## 🚀 Uso

### **Para el usuario:**

1. **Flujo proactivo (signup):**
   ```
   Usuario visita página de registro
   → Aparece notification azul: "¿Crear contraseña segura?"
   → Usuario click "Abrir Vault"
   → Popup se abre con generador de passwords
   → Usuario crea credencial segura
   ```

2. **Flujo reactivo (post-submit):**
   ```
   Usuario crea cuenta en sitio web
   → Submit exitoso detectado
   → Aparece notification verde: "¿Guardar en vault?"
   → Usuario click "Guardar"
   → Credencial guardada automáticamente
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
