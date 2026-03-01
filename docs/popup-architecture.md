# Popup Architecture (2026 Refactor)

## Resumen

El popup dejó de ser un archivo monolítico y ahora sigue una arquitectura modular por capas:

- **Entrypoint**: `src/popup/main.tsx`
- **Wiring/Bootstrap**: `src/popup/popup.tsx`
- **State**: `src/popup/app/state/*`
- **Actions (API + side effects)**: `src/popup/app/actions/*`
- **Handlers (submit/click)**: `src/popup/app/handlers/*`
- **Renderizado de pantallas**: `src/popup/ui/screens/renderers.ts`

## Flujo de ejecución

1. `main.tsx` carga `popup.tsx`.
2. `popup.tsx` inicializa estado, wiring de listeners y render principal.
3. `popupHandlers.ts` enruta acciones de UI a:
   - `vaultHandlers.ts` para acciones de vault/recovery/HIBP audit.
   - `entryHandlers.ts` para CRUD de entradas y acciones de detalle.
4. `vaultActions.ts` encapsula mensajería con background y refresco de estado.
5. `renderers.ts` genera el HTML por pantalla según `route` y `screen`.

## Objetivo del refactor

- Reducir tamaño de archivos y acoplamiento.
- Facilitar merge de features paralelas.
- Cambiar tests frágiles de inspección textual a tests de comportamiento.
- Mantener build y contrato público de mensajes sin cambios funcionales.

## Testing relacionado

- `tests/popup-entry-delete.test.ts`: validación de flujo de borrado por handlers y render.
- `tests/credential-assistant-flow.test.ts`: validación del cierre del popup tras unlock exitoso.

