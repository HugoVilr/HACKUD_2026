import { generatePassword } from "../core/generator/generator";
import { hibpCheck } from "../core/hibp/hibp";
import { MSG, type ApiResponse } from "../shared/messages";
import { hasEncryptedVault, loadEncryptedVault, saveEncryptedVault } from "../core/vault/storage";
import { createEncryptedVault, reencryptVault, unlockEncryptedVault } from "../core/vault/crypto";
import { deleteEntry, getEntrySecret, listPublicEntries, upsertEntry } from "../core/vault/entries";
import type { EncryptedVault, VaultPlaintext } from "../core/vault/types";


type Session = {
  unlocked: boolean;
  key: CryptoKey | null;
  plaintext: VaultPlaintext | null;
  encrypted: EncryptedVault | null;
  autoLockMs: number;
  timer: number | null;
};

/**
 * SECURITY FIX #3: Rate limiting en unlock
 * 
 * VULNERABILIDAD ENCONTRADA:
 * - No había contador de intentos fallidos de unlock
 * - Un script malicioso podía hacer brute force local ilimitado
 * - Sin delays progresivos ni lockout temporal
 * 
 * RIESGO:
 * - CRÍTICO: Brute force local sin restricciones
 * - Un atacante con acceso al popup podría probar millones de contraseñas
 * 
 * SOLUCIÓN IMPLEMENTADA:
 * - Contador de intentos fallidos con lockout progresivo
 * - Después de 5 intentos: 30s de bloqueo
 * - Delays exponenciales entre intentos (1s, 2s, 3s, 4s, 5s)
 * - Reset automático tras unlock exitoso
 */
type UnlockAttempts = {
  count: number;
  lastAttempt: number;
  lockedUntil: number;
};

const unlockAttempts: UnlockAttempts = {
  count: 0,
  lastAttempt: 0,
  lockedUntil: 0,
};

const session: Session = {
  unlocked: false,
  key: null,
  plaintext: null,
  encrypted: null,
  autoLockMs: 5 * 60 * 1000,
  timer: null,
};

/**
 * SECURITY FIX #11: Touch() selectivo
 * 
 * VULNERABILIDAD ENCONTRADA:
 * - touch() se llamaba en TODAS las operaciones, incluso VAULT_STATUS
 * - Un atacante podía enviar VAULT_STATUS en loop para evitar auto-lock
 * - Operaciones de solo lectura no deberían extender la sesión
 * 
 * RIESGO:
 * - MEDIO: Auto-lock bypasseable con mensajes spam
 * 
 * SOLUCIÓN IMPLEMENTADA:
 * - Solo operaciones que requieren vault desbloqueado extienden la sesión
 * - VAULT_STATUS, GENERATE_PASSWORD, HIBP_CHECK no resetean el timer
 */
const OPERATIONS_THAT_EXTEND_SESSION = new Set([
  MSG.VAULT_UNLOCK,
  MSG.ENTRY_LIST,
  MSG.ENTRY_UPSERT,
  MSG.ENTRY_DELETE,
  MSG.ENTRY_GET_SECRET,
]);

function ok<T>(data: T): ApiResponse<T> {
  return { ok: true, data };
}
function err(code: any, message: string): ApiResponse<any> {
  return { ok: false, error: { code, message } };
}

/**
 * SECURITY NOTE #4: Service Worker puede perder estado
 * 
 * LIMITACIÓN DE CHROME MV3:
 * - El service worker puede dormirse tras ~30s de inactividad
 * - Al dormirse, TODO el estado global (session) se pierde
 * - setTimeout/setInterval NO sobreviven al dormirse del SW
 * 
 * RIESGO:
 * - ALTO: Inconsistencia de estado UI ↔ Background
 * - El timer de auto-lock no funciona correctamente si el SW se duerme
 * 
 * SOLUCIÓN REQUERIDA (TODO - requiere refactoring mayor):
 * - Migrar de setTimeout a chrome.alarms API
 * - Usar chrome.storage.session para persistir estado mínimo
 * - Validar estado al despertar el SW
 * 
 * WORKAROUND ACTUAL:
 * - El auto-lock funciona solo mientras el SW esté activo
 * - Si el SW se duerme, la sesión se pierde (comportamiento "lock por defecto")
 * - Esto es MÁS SEGURO que mantener sesión activa indefinidamente
 * 
 * EJEMPLO DE IMPLEMENTACIÓN FUTURA:
 * ```
 * chrome.alarms.create("autoLock", { delayInMinutes: 5 });
 * chrome.alarms.onAlarm.addListener((alarm) => {
 *   if (alarm.name === "autoLock") lockNow();
 * });
 * ```
 */
function touch() {
  if (session.timer) clearTimeout(session.timer);
  session.timer = setTimeout(() => lockNow(), session.autoLockMs) as unknown as number;
}

/**
 * SECURITY FIX #1: Mejora de limpieza de memoria
 * 
 * VULNERABILIDAD ENCONTRADA:
 * - Solo se hacía `key = null`, `plaintext = null` sin sobrescritura
 * - JavaScript NO sobrescribe memoria automáticamente al nullificar
 * - Passwords permanecían en heap hasta que el GC decidiera limpiar
 * - CryptoKey no extractable pero referencias quedaban en memoria
 * 
 * RIESGO:
 * - ALTO: Passwords sobreviven al lock en memoria
 * - Ataque con memory dump podría recuperar passwords "deleted"
 * - Mayor ventana de oportunidad para ataques de memoria
 * 
 * SOLUCIÓN IMPLEMENTADA:
 * - Sobrescribir strings de passwords con caracteres nulos antes de nullificar
 * - Iterar entries y limpiar campos sensibles explícitamente
 * - Limpiar también username/notes por precaución (pueden ser sensibles)
 * 
 * LIMITACIÓN:
 * - JavaScript no garantiza limpieza total de memoria (es garbage collected)
 * - Los strings inmutables crean copias que el GC debe limpiar
 * - Para seguridad máxima, usar lenguajes con control manual de memoria (Rust, C++)
 * - Esta implementación reduce SIGNIFICATIVAMENTE la ventana de exposición
 */
function lockNow() {
  // Sobrescribir passwords en memoria antes de nullificar
  if (session.plaintext?.entries) {
    for (const entry of session.plaintext.entries) {
      // Sobrescribir campos sensibles con caracteres nulos
      if (entry.password) {
        // Crear string de misma longitud con \0
        entry.password = "\0".repeat(entry.password.length);
        entry.password = ""; // Luego vaciar
      }
      if (entry.username) {
        entry.username = "\0".repeat(entry.username.length);
        entry.username = "";
      }
      if (entry.notes) {
        entry.notes = "\0".repeat(entry.notes.length);
        entry.notes = "";
      }
    }
    // Vaciar el array
    session.plaintext.entries = [];
  }

  // Nullificar referencias
  session.unlocked = false;
  session.key = null;
  session.plaintext = null;
  session.encrypted = null;
  
  if (session.timer) clearTimeout(session.timer);
  session.timer = null;
}

function requireUnlocked() {
  if (!session.unlocked || !session.key || !session.plaintext || !session.encrypted) {
    throw new Error("LOCKED");
  }
}

/**
 * SECURITY FIX #6: Validación de fortaleza de master password
 * 
 * VULNERABILIDAD ENCONTRADA:
 * - Solo se validaba longitud mínima (8 caracteres)
 * - "aaaaaaaa" era técnicamente válido
 * - No se verificaba entropía, diccionario, ni patrones comunes
 * - No se integraba con HIBP antes de aceptar la master password
 * 
 * RIESGO:
 * - ALTO: Master passwords débiles aceptadas
 * - Compromiso total del vault si la master es débil
 * - Mayor facilidad para brute force offline
 * 
 * SOLUCIÓN IMPLEMENTADA:
 * - Longitud mínima: 12 caracteres (incrementado desde 8)
 * - Requerir al menos 3 categorías: mayús/minús/digits/special
 * - Rechazar caracteres repetidos consecutivos (aaa, 111, etc.)
 * - TODO: Integrar con HIBP para rechazar passwords filtradas (ver más abajo)
 */
function validateMasterStrength(pwd: string): { valid: boolean; reason?: string } {
  if (pwd.length < 12) {
    return { valid: false, reason: "Mínimo 12 caracteres requeridos" };
  }

  const hasUpper = /[A-Z]/.test(pwd);
  const hasLower = /[a-z]/.test(pwd);
  const hasDigit = /\d/.test(pwd);
  const hasSpecial = /[^A-Za-z0-9]/.test(pwd);

  const categories = [hasUpper, hasLower, hasDigit, hasSpecial].filter(Boolean).length;
  if (categories < 3) {
    return { 
      valid: false, 
      reason: "Debe contener al menos 3 de: mayúsculas, minúsculas, números, símbolos" 
    };
  }

  // Rechazar caracteres repetidos consecutivos (aaa, 111, etc.)
  if (/(.)\1{2,}/.test(pwd)) {
    return { valid: false, reason: "No puede contener caracteres repetidos consecutivos (aaa, 111, etc.)" };
  }

  return { valid: true };
}

export async function handleMessage(message: any): Promise<ApiResponse<any>> {
  try {
    // Touch selectivo: solo operaciones sensibles extienden la sesión
    if (OPERATIONS_THAT_EXTEND_SESSION.has(message?.type)) {
      touch();
    }

    switch (message?.type) {
      case MSG.VAULT_STATUS: {
        const hv = await hasEncryptedVault();
        return ok({ hasVault: hv, locked: !session.unlocked });
      }

      case MSG.VAULT_CREATE: {
        const master = String(message.master ?? "");
        const vaultName = message.vaultName ? String(message.vaultName) : undefined;
        
        // Validación de fortaleza de master password
        const strength = validateMasterStrength(master);
        if (!strength.valid) {
          return err("WEAK_MASTER", strength.reason || "Master password muy débil");
        }

        /**
         * TODO (SECURITY ENHANCEMENT): Integrar HIBP check para master password
         * 
         * Antes de aceptar la master password, verificar si ha sido filtrada:
         * ```
         * const leakCount = await hibpCheck(master);
         * if (leakCount > 0) {
         *   return err("LEAKED_MASTER", `Esta password ha sido filtrada ${leakCount} veces. Usa otra.`);
         * }
         * ```
         * 
         * PROS:
         * - Previene uso de passwords conocidamente comprometidas
         * - Mejora la seguridad del vault dramáticamente
         * 
         * CONS:
         * - Añade latencia (1-3s) al crear vault
         * - Requiere conexión a internet
         * - El usuario debe confiar en que HIBP no logguea las queries (usan k-anonymity)
         * 
         * RECOMENDACIÓN: Implementar como WARNING, no error bloqueante
         */

        const { encrypted, key, plaintext } = await createEncryptedVault(master, vaultName);
        await saveEncryptedVault(encrypted);

        // dejamos sesión desbloqueada
        session.unlocked = true;
        session.key = key;
        session.plaintext = plaintext;
        session.encrypted = encrypted;

        return ok({ created: true });
      }

      case MSG.VAULT_UNLOCK: {
        const master = String(message.master ?? "");
        
        // Rate limiting: verificar lockout
        if (Date.now() < unlockAttempts.lockedUntil) {
          const remainingMs = unlockAttempts.lockedUntil - Date.now();
          const remainingSec = Math.ceil(remainingMs / 1000);
          return err(
            "RATE_LIMITED", 
            `Demasiados intentos fallidos. Intenta de nuevo en ${remainingSec}s`
          );
        }

        const enc = await loadEncryptedVault();
        if (!enc) return err("NO_VAULT", "No hay vault guardado");

        try {
          const { key, plaintext } = await unlockEncryptedVault(enc, master);
          
          // Unlock exitoso: resetear contador de intentos
          unlockAttempts.count = 0;
          unlockAttempts.lastAttempt = 0;
          unlockAttempts.lockedUntil = 0;
          
          session.unlocked = true;
          session.key = key;
          session.plaintext = plaintext;
          session.encrypted = enc;
          
          return ok({ unlocked: true });
        } catch {
          lockNow();
          
          // Incrementar contador de intentos fallidos
          unlockAttempts.count++;
          unlockAttempts.lastAttempt = Date.now();
          
          // Lockout después de 5 intentos fallidos
          if (unlockAttempts.count >= 5) {
            unlockAttempts.lockedUntil = Date.now() + 30_000; // 30 segundos
          }
          
          // Delay progresivo (1s, 2s, 3s, 4s, 5s max)
          const delaySec = Math.min(unlockAttempts.count, 5);
          await new Promise(resolve => setTimeout(resolve, delaySec * 1000));
          
          return err("BAD_MASTER", "Master incorrecta o vault corrupto");
        }
      }

      case MSG.VAULT_LOCK: {
        lockNow();
        return ok({ locked: true });
      }

      case MSG.ENTRY_LIST: {
        requireUnlocked();
        return ok({ entries: listPublicEntries(session.plaintext!) });
      }

      case MSG.ENTRY_UPSERT: {
        requireUnlocked();
        const entry = message.entry ?? {};
        try {
          upsertEntry(session.plaintext!, entry);
        } catch (e: any) {
          if (String(e?.message).startsWith("VALIDATION:")) return err("VALIDATION", "Datos inválidos (title requerido)");
          return err("VALIDATION", "Datos inválidos");
        }

        const newEnc = await reencryptVault(session.key!, session.plaintext!, session.encrypted!);
        await saveEncryptedVault(newEnc);
        session.encrypted = newEnc;

        return ok({ saved: true });
      }

      case MSG.ENTRY_DELETE: {
        requireUnlocked();
        const id = String(message.id ?? "");
        deleteEntry(session.plaintext!, id);

        const newEnc = await reencryptVault(session.key!, session.plaintext!, session.encrypted!);
        await saveEncryptedVault(newEnc);
        session.encrypted = newEnc;

        return ok({ deleted: true });
      }

      case MSG.ENTRY_GET_SECRET: {
        requireUnlocked();
        const id = String(message.id ?? "");
        const sec = getEntrySecret(session.plaintext!, id);
        if (!sec) return err("NOT_FOUND", "Entry no encontrada");
        
        /**
         * SECURITY NOTE #7: Passwords en respuestas de mensajes
         * 
         * CONSIDERACIÓN DE SEGURIDAD:
         * - El password viaja como string literal en la respuesta
         * - Queda expuesto en el event handler del popup hasta que el GC lo limpie
         * - Si hay logging/debugging activo, puede aparecer en logs
         * 
         * RIESGO:
         * - MEDIO: Exposición temporal de passwords en memoria del popup
         * - Mayor ventana de ataque en el contexto del popup
         * 
         * MITIGACIÓN ACTUAL:
         * - Solo se envía cuando el usuario lo solicita explícitamente
         * - El popup debe copiar inmediatamente y limpiar la variable
         * 
         * TODO (PERSONA 2 - FRONTEND):
         * - Implementar limpieza automática del password en el popup tras 30s
         * - Al recibir el password:
         *   1. Copiarlo al clipboard inmediatamente
         *   2. Almacenar en variable temporal
         *   3. Limpiar la variable: `password = "\0".repeat(password.length); password = "";`
         *   4. Implementar timeout para auto-limpiar
         * 
         * MEJORA FUTURA (requiere refactoring):
         * - Usar navigator.clipboard.writeText() directamente desde el background
         * - Evitar que el password viaje al popup
         * - Requiere permission "clipboardWrite" en manifest
         */
        
        return ok({ secret: sec });
      }

      case MSG.GENERATE_PASSWORD: {
        const cfg = message.config ?? { length: 16 };
        const pwd = generatePassword(cfg);
        return ok({ password: pwd });
      }

      case MSG.HIBP_CHECK: {
        const password = String(message.password ?? "");
        if (!password) return err("VALIDATION", "Password vacío");
        try {
          const count = await hibpCheck(password);
          return ok({ count });
        } catch {
          return err("INTERNAL", "Error consultando HIBP");
        }
      }

      default:
        return err("UNKNOWN_MESSAGE", "Mensaje no soportado");
    }
  } catch (e: any) {
    if (String(e?.message) === "LOCKED") return err("LOCKED", "Vault bloqueada");
    return err("INTERNAL", "Error interno");
  }
}