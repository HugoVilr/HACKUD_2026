# HIBP Audit (Vault Leak Audit)

Esta extensión permite auditar todas las credenciales del vault contra HIBP:

- Password audit: endpoint de pwned passwords (`/range/{prefix}`).
- Domain audit: brechas por dominio (`/breaches?domain=...`).

## Flujo completo

1. El usuario pulsa `Leak audit` en el popup.
2. El popup envía `HIBP_AUDIT_START` al background.
3. El background crea un `auditId`, guarda estado inicial y lanza el runner asíncrono.
4. Se abre la página de reporte con `src/report/report.html?audit=<auditId>`.
5. El reporte hace polling:
   - `HIBP_AUDIT_STATUS` para progreso.
   - `HIBP_AUDIT_RESULT` cuando el estado ya no es `running`.
6. El reporte también consulta `HIBP_AUDIT_SCHEDULE` para mostrar última y próxima ejecución.

## Estados de auditoría

- `running`: auditoría en curso.
- `done`: finalizada correctamente.
- `failed`: error global de ejecución.
- `aborted`: abortada (por ejemplo, vault bloqueado durante ejecución).

## Mensajes implicados

- `HIBP_AUDIT_START`
- `HIBP_AUDIT_STATUS`
- `HIBP_AUDIT_RESULT`
- `HIBP_AUDIT_SCHEDULE`

Contratos tipados en:

- `src/shared/messages.ts`

## Archivos clave

- `src/background/session.ts`
  - Orquestación de auditoría, scheduler, persistencia de estado.
- `src/background/sw.ts`
  - Router de mensajes con validación de origen.
- `src/popup/popup.tsx`
  - Botón `Leak audit` y apertura de la página de reporte.
- `src/report/report.html`
  - Estructura visual del reporte.
- `src/report/report.tsx`
  - Lógica de polling, render de progreso/resultados, debug y relanzado manual.
- `src/report/report.css`
  - Estilos del dashboard de auditoría.

## Build requerido

El reporte necesita compilarse para generar `src/report/report.js`.

En `package.json` el script `build` debe incluir:

- `esbuild src/report/report.tsx --bundle ... --outfile=src/report/report.js`

Si no existe `report.js`, la vista puede quedarse en `Inicializando...` sin actualizar.

## Troubleshooting rápido

- Pantalla en `Inicializando...`:
  - verificar que existe `src/report/report.js`.
  - ejecutar `npm run build` y recargar la extensión.
- `No se pudo obtener el estado`:
  - comprobar que el vault está desbloqueado.
  - revisar `auditId` en URL (`?audit=...`).
- Errores HIBP intermitentes:
  - posible rate limit (`429`) o rechazo (`403`) del endpoint de dominio.
  - consultar bloque `Debug` en el reporte para ver detalles.

