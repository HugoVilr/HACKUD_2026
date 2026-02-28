# Autofill en Web (Content Script)

Esta funcionalidad añade autocompletado de credenciales en formularios web usando un `content_script` de MV3.

## Resumen

- Inserta un botón de candado junto a campos de login.
- Si el vault está bloqueado, abre el popup para desbloquear.
- Si está desbloqueado, muestra sugerencias por dominio.
- Al seleccionar una credencial, rellena usuario/email y contraseña.

## Componentes

- `manifest.json`
  - `content_scripts` con:
    - `src/content/autofill.js`
    - `src/content/autofill.css`
- `src/content/autofill.ts`
  - Detección de campos.
  - UI flotante (candado + panel).
  - Solicitud de estado/sugerencias/secreto vía `chrome.runtime.sendMessage`.
- `src/background/sw.ts`
  - Validación de origen + allowlist para content scripts.
  - Soporte de `UI_OPEN_POPUP`.
- `src/background/session.ts`
  - Lógica de `AUTOFILL_QUERY_BY_DOMAIN`.
- `src/shared/messages.ts`
  - Contrato tipado de mensajes.

## Flujo funcional

1. Usuario enfoca un input compatible (`text`, `email`, `password`).
2. Aparece candado en el lado derecho del input.
3. Click en candado:
   - `VAULT_STATUS`
   - Si `locked`: `UI_OPEN_POPUP` para desbloqueo.
   - Si `unlocked`: `AUTOFILL_QUERY_BY_DOMAIN` con `window.location.hostname`.
4. Se muestran credenciales sugeridas.
5. Click en credencial:
   - `ENTRY_GET_SECRET`
   - Rellenado de campos + eventos `input/change`.

## Estilo y estados del candado

- Fondo negro.
- Icono:
  - Rojo: vault bloqueado.
  - Verde: vault listo.
- El candado se posiciona a la derecha y centrado verticalmente en el input.

## Reglas de seguridad

- Solo se permiten desde content scripts estos mensajes:
  - `VAULT_STATUS`
  - `AUTOFILL_QUERY_BY_DOMAIN`
  - `ENTRY_GET_SECRET`
  - `UI_OPEN_POPUP`
- Cualquier otro mensaje desde `sender.tab` se bloquea (`FORBIDDEN`).
- Se mantiene validación `sender.id === chrome.runtime.id`.
- El secreto se solicita únicamente tras selección explícita del usuario.

## Matching por dominio

Prioridad de coincidencia:

1. `exact`: dominio de entry == hostname actual.
2. `suffix`: subdominio compatible.
3. `title`: fallback por título.

Recomendación de datos:

- Guardar `domain` en cada entry (`pccomponentes.com`, `github.com`, etc.).

## Comportamiento al desbloquear

- Si se abre popup desde candado y el unlock es correcto:
  - se ocultan automáticamente candado y panel al volver a la página.
- Si sigue bloqueado:
  - se mantiene candado en estado rojo.

## Troubleshooting rápido

- `runtime no disponible`:
  - recargar extensión y página.
- `No hay credenciales`:
  - revisar `domain` en la entry.
- `Content scripts are not allowed...`:
  - verificar allowlist en `src/background/sw.ts`.

## Testing

Cobertura relevante:

- `tests/autofill-infra.test.ts`
  - manifest/build/archivos de autofill.
- `tests/integration/vault-flow.test.ts`
  - mensaje `AUTOFILL_QUERY_BY_DOMAIN`.
- `tests/integration/sw-origin-guard.test.ts`
  - validación de origen y allowlist de content scripts.
