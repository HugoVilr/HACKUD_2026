# HIBP Pwned Passwords (k-anonymity)

Esta extensión usa **Have I Been Pwned – Pwned Passwords** para comprobar si una contraseña aparece en filtraciones.

## Resumen (cómo funciona)

- Se calcula **SHA-1(password)** **localmente**.
- Se envían solo los **5 primeros caracteres** del hash (prefijo) al endpoint `/range/{prefix}`.
- HIBP devuelve sufijos con conteos; se compara el **sufijo** local y se obtiene el **count**.

Así, HIBP **no recibe la contraseña** ni el hash completo (k-anonymity).

## Código relacionado

- Lógica HIBP (hash + fetch + parse + errores/timeout): `src/core/hibp/hibp.ts`
- Background router (la request sale desde el service worker): `src/background/sw.ts`
- Tipos de mensaje/payload/response: `src/shared/messages.ts`
- Cliente tipado en popup: `src/popup/api/backgroundClient.ts`

## Permisos (MV3)

Para poder llamar a HIBP desde el background:

- `manifest.json` debe incluir:
  - `background.service_worker`: `src/background/sw.js`
  - `host_permissions`: `https://api.pwnedpasswords.com/*`

## Contrato de mensajes

### Request

```ts
{ type: MESSAGE_TYPES.HIBP_CHECK, payload: { password: string } }
```

### Response

```ts
// éxito
{ ok: true, data: { count: number } }

// error
{ ok: false, error: { code: string; message: string } }
```

## Uso desde la UI (popup)

Con el cliente tipado:

```ts
import { backgroundClient } from "./api/backgroundClient";

const result = await backgroundClient.hibpCheck({ password });
if (result.ok) {
  console.log(`Filtrada ${result.data.count} veces`);
} else {
  console.error(result.error.code, result.error.message);
}
```

## Notas de privacidad

- HIBP solo ve el **prefijo** del SHA-1 (k-anonymity).
- Internamente, el password viaja de UI → background por `chrome.runtime.sendMessage`. Si se quiere reducir exposición interna, se puede cambiar el contrato para que la UI envíe el SHA-1 (o prefijo+sufijo) en lugar del texto plano.

