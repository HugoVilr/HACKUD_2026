# Auto-Capture y Asistente de Credenciales

## Resumen

El content script `src/content/credential-assistant.ts` detecta formularios de registro/login y guía al usuario para crear o guardar credenciales en G8keeper.

## Flujo de Signup (actual)

1. Se detecta formulario de registro.
2. Se muestra un aviso in-page (`g8keeper-signup-notification`) **siempre**, independientemente de si el vault está bloqueado o desbloqueado.
3. Si el usuario pulsa `Ignorar` o cierra el aviso, no ocurre nada más.
4. Si el usuario pulsa `Abrir Vault`:
   - Se cierra el aviso inmediatamente.
   - Si el vault está bloqueado, se abre el popup de la extensión para desbloquear.
   - El content script espera el desbloqueo (`waitForVaultUnlock`, polling hasta 60s).
5. Al desbloquearse, el popup se cierra automáticamente (`window.close()` en `src/popup/popup.tsx`) y se abre el modal in-page para crear credencial segura.
6. Al guardar en el modal:
   - Se crea la entrada en el vault (`ENTRY_ADD`).
   - Se rellenan username/password en el formulario detectado.

## Flujo Post-Submit (captura pasiva)

1. Se escucha `submit` en formularios detectados.
2. Si se capturan credenciales y no se detectan errores visibles tras un delay, se sugiere guardar en vault.
3. Este guardado pasivo requiere vault desbloqueado en ese momento.

## Mensajería involucrada

- `VAULT_STATUS`: consulta estado del vault desde content script.
- `OPEN_POPUP_FOR_SIGNUP`: solicita abrir popup para desbloqueo cuando hace falta.
- `ENTRY_ADD`: guarda credenciales creadas/capturadas.
- `GENERATE_PASSWORD`: genera contraseña fuerte para el modal de creación.
- `AUTOFILL_CREDENTIALS`: canal para relleno programático desde background.

## Archivos clave

- `src/content/credential-assistant.ts`: detección de formularios, aviso signup, modal de creación y captura pasiva.
- `src/popup/popup.tsx`: unlock UI; cierra popup tras desbloqueo correcto.
- `src/background/session.ts`: handlers de `OPEN_POPUP_FOR_SIGNUP` y operaciones de vault.
- `src/background/sw.ts`: allowlist/ruteo de mensajes entre content script y backend.
- `src/shared/messages.ts`: tipos de mensaje compartidos.

## Tests

- `tests/credential-assistant-flow.test.ts`
  - Verifica que el flujo de unlock en signup existe (`waitForVaultUnlock`).
  - Verifica que aceptar el aviso cierra el aviso inmediatamente.
  - Verifica que `monitorForms` ya no bloquea el aviso por vault bloqueado.
  - Verifica que el popup incluye `window.close()` al desbloquear.

## Ejecución local

```bash
npm run build
npm test -- --runInBand
```

## Notas

- Para probar en Chrome tras cambios de content scripts: recarga la extensión en `chrome://extensions` y recarga también la pestaña de la web objetivo.
