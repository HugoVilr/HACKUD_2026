# Seeking the Perfect Key 🔐

> **Chrome Extension Vault** - Password Manager seguro con cifrado local, generador y verificación de filtraciones

Proyecto desarrollado para **HackUDC 2026** - Reto: "Seeking the Perfect Key" - Gradiant

---
## TODOS:
- [ ] IMPORTANTE Hacer revisión de contraseñas si han sido leakeadas con 
- [ ] Eliminar contraseñas individuales
- [x] Autocompletar
- [ ] Guardar contraseñas que acabas de crear
- [x] Guardar contraseñas automático recomendado
- [ ] Historial de contraseñas


## 🎯 Características

- ✅ **Vault cifrado local** con AES-256-GCM + PBKDF2 (600k iterations)
- ✅ **Gestión de credenciales** (crear, editar, eliminar, buscar)
- ✅ **Generador de passwords** seguro (CSPRNG sin sesgo estadístico)
- ✅ **Verificación de filtraciones** con HIBP API (k-anonymity + padding)
- ✅ **Auto-lock** tras 5 minutos de inactividad
- ✅ **Rate limiting** en unlock (protección contra brute force local)
- ✅ **Master password validation** (complejidad y longitud)
- ✅ **Seguridad por diseño** (validación de origen, CSP, limpieza de memoria)
- ✅ **Autofill web** (candado + sugerencias por dominio + rellenado)

---

## 🏗️ Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                        POPUP UI                            │
│  (React/TS - Pantallas de usuario)                         │
└────────────────────┬────────────────────────────────────────┘
                     │ chrome.runtime.sendMessage
                     │ (Validated origin)
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              BACKGROUND SERVICE WORKER                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Session Management (Auto-lock + Rate limiting)      │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Crypto Core (PBKDF2 + AES-GCM)                      │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Integrations (HIBP + Generator)                     │   │
│  └─────────────────────────────────────────────────────┘   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
          chrome.storage.local
          (Solo vault cifrado)
```

---

## 🔒 Seguridad

Ver **[SECURITY.md](SECURITY.md)** para documentación completa de seguridad.
Ver `docs/hibp.md` para detalles de la integración HIBP (k-anonymity).
Ver `docs/autofill.md` para detalles del autocompletado en páginas web.

**Highlights**:
- **Encryption**: AES-256-GCM con PBKDF2-SHA256 (600,000 iterations)
- **K-Anonymity**: HIBP queries solo envían 5 caracteres del hash SHA-1
- **Rate Limiting**: Lockout tras 5 intentos fallidos de unlock
- **Master Password**: Validación de complejidad (12+ chars, 3 categorías)
- **CSP**: Content Security Policy explícito en manifest
- **Memory Cleanup**: Best-effort cleanup con sobrescritura de strings
- **Origin Validation**: Solo mensajes de la propia extensión son procesados

---

## 🚀 Setup

### Requisitos
- Node.js 20+ LTS
- npm o pnpm
- Chrome/Chromium

### Instalación

```bash
# Clonar repo
git clone https://github.com/HugoVilr/HACKUD_2026.git
cd HACKUD_2026

# Instalar dependencias
npm install

# Build (TODO: configurar Vite/esbuild)
npm run build

# Cargar extensión en Chrome:
# 1. chrome://extensions
# 2. Activar "Developer mode"
# 3. "Load unpacked" → seleccionar carpeta dist/
```

---

## 📁 Estructura del Proyecto

```
HACKUD_2026/
├── src/
│   ├── background/          # Service Worker (core security)
│   │   ├── sw.ts           # Message router con validación de origen
│   │   └── session.ts      # Session management + auto-lock + rate limiting
│   ├── core/
│   │   ├── vault/          # Crypto core (PBKDF2 + AES-GCM)
│   │   │   ├── crypto.ts   # Encryption/decryption
│   │   │   ├── types.ts    # Tipos: EncryptedVault, VaultPlaintext
│   │   │   ├── guards.ts   # Runtime type validation
│   │   │   ├── storage.ts  # chrome.storage.local wrapper
│   │   │   └── entries.ts  # CRUD de credenciales
│   │   ├── generator/      # Password generator (CSPRNG)
│   │   └── hibp/           # HIBP API integration (k-anonymity)
│   ├── popup/              # UI (React/TS)
│   │   ├── ui/
│   │   │   ├── components/ # Button, Input, Toast
│   │   │   └── screens/    # CreateVault, Unlock, VaultList, etc.
│   │   ├── api/
│   │   │   └── backgroundClient.ts  # Wrapper para sendMessage
│   │   └── App.tsx
│   ├── shared/             # Utilidades compartidas
│   │   ├── messages.ts     # Contrato de mensajes (types)
│   │   ├── b64.ts          # Base64 encoding/decoding
│   │   └── time.ts         # ISO timestamps
│   └── manifest.json       # Chrome Extension MV3 manifest
├── SECURITY.md             # Documentación de seguridad
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🛠️ Desarrollo

### Scripts (TODO: configurar)

```bash
npm run dev      # Development mode con hot reload
npm run build    # Build para producción
npm run test     # Run tests (TODO)
npm run lint     # Lint con ESLint (TODO)
```

### Workflow Git

- `main`: Código estable (releases)
- `develop`: Integración continua
- `feature/*`: Features individuales
- `vaultwork`: Rama actual (core de seguridad)

### Commits

Usamos **Conventional Commits**:
```
feat(vault): añadir rate limiting en unlock
fix(crypto): corregir IV reusage en reencrypt
docs(security): actualizar threat model
```

---

## 👥 Equipo (HackUDC 2026)

- **Persona 1 (Security/Core)**: Background SW, cripto, storage, session management
- **Persona 2 (UX/UI)**: Popup, pantallas, componentes, flujos de usuario
- **Persona 3 (Integraciones)**: HIBP, generador, tests, build, deploy

---

## 🎯 Roadmap

### ✅ Fase 1: Core de Seguridad (COMPLETADO)
- [x] Estructura MV3 base (manifest + background + popup)
- [x] Modelo de datos versionado
- [x] Cifrado AES-256-GCM + PBKDF2 (600k iters)
- [x] Session management con auto-lock
- [x] CRUD de entries con re-encryption
- [x] Validación de origen de mensajes
- [x] Rate limiting en unlock
- [x] Master password validation
- [x] HIBP integration con k-anonymity
- [x] Password generator sin sesgo
- [x] CSP explícito

### 🔄 Fase 2: Frontend (EN PROGRESO)
- [ ] Pantallas de UI (CreateVault, Unlock, VaultList, etc.)
- [ ] Componentes React (Button, Input, Toast)
- [ ] Flujo completo de usuario
- [ ] Clipboard auto-clear
- [ ] Feedback visual de seguridad

### 📋 Fase 3: Polish & Deploy
- [ ] Tests unitarios (crypto, generator, HIBP parser)
- [ ] Build system (Vite/esbuild)
- [ ] Manejo de errores mejorado
- [ ] Iconos y assets
- [ ] README con screenshots
- [ ] Deploy a Chrome Web Store (opcional)

### 🚀 Mejoras Futuras (Post-Hackathon)
- [ ] Migrar a Argon2id (mejor que PBKDF2)
- [ ] chrome.alarms para auto-lock (sobrevive SW sleep)
- [ ] AAD en AES-GCM (proteger metadatos)
- [ ] HIBP check en master password creation
- [ ] Strength meter con zxcvbn
- [ ] Export/import cifrado (backup)
- [ ] Passphrase generator (diceware)

---

## 📚 Referencias

- [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [HIBP API](https://haveibeenpwned.com/API/v3)
- [Chrome Extensions MV3](https://developer.chrome.com/docs/extensions/mv3/)
- [WebCrypto API](https://www.w3.org/TR/WebCryptoAPI/)

---

## 📝 Licencia

MIT License - HackUDC 2026

---

## 🏆 HackUDC 2026 - Reto Gradiant

**Criterios de evaluación**:
- ✅ Innovación & Creatividad
- ✅ User Experience (UX/UI)
- ✅ **Security Design** ← Nuestro foco principal

**Premio**: 8Bitdo Retro Mechanical Keyboard & Mouse

---

**Estado actual**: 🟢 Core de seguridad completado - Esperando integración con UI
