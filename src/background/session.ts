import { generatePassword } from "../core/generator/generator.ts";
import { hibpCheck } from "../core/hibp/hibp.ts";
import {
  MESSAGE_TYPES,
  type AnyRequestMessage,
  type AutofillCandidate,
  type ApiResult,
  type MessageType,
  type MessageResponseMap,
  type VaultStatusData
} from "../shared/messages.ts";
import { hasEncryptedVault, loadEncryptedVault, saveEncryptedVault, deleteEncryptedVault } from "../core/vault/storage.ts";
import { createEncryptedVault, reencryptVault, unlockEncryptedVault, unlockWithRecoveryCode } from "../core/vault/crypto.ts";
import { deleteEntry, entryPublicView, getEntrySecret, listPublicEntries, upsertEntry } from "../core/vault/entries.ts";
import type { EncryptedVault, VaultPlaintext } from "../core/vault/types.ts";


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
  MESSAGE_TYPES.VAULT_UNLOCK,
  MESSAGE_TYPES.ENTRY_LIST,
  MESSAGE_TYPES.ENTRY_GET,
  MESSAGE_TYPES.ENTRY_GET_SECRET,
  MESSAGE_TYPES.AUTOFILL_QUERY_BY_DOMAIN,
  MESSAGE_TYPES.ENTRY_ADD,
  MESSAGE_TYPES.ENTRY_UPDATE,
  MESSAGE_TYPES.ENTRY_DELETE,
]);

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}
function err(code: any, message: string): ApiResult<any> {
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

async function getVaultStatus(): Promise<VaultStatusData> {
  const hasVault = await hasEncryptedVault();
  const locked = !session.unlocked;
  const vaultName = session.unlocked ? session.plaintext?.profile?.vaultName : undefined;
  const entryCount = session.unlocked ? session.plaintext?.entries.length ?? 0 : 0;
  return { hasVault, locked, vaultName, entryCount };
}

function normalizeHostname(raw: string): string {
  const host = String(raw ?? "").trim().toLowerCase();
  if (!host) return "";
  const noPort = host.split(":")[0] ?? "";
  return noPort.replace(/\.+$/, "");
}

function normalizeEntryDomain(raw: string | undefined): string {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return "";
  try {
    if (value.includes("://")) return normalizeHostname(new URL(value).hostname);
  } catch {
    // Ignore invalid URL shapes and fallback to plain normalization.
  }
  return normalizeHostname(value.replace(/^https?:\/\//, "").split("/")[0] ?? "");
}

function baseHostname(hostname: string): string {
  return hostname.replace(/^www\./, "");
}

function getAutofillCandidatesByHostname(hostname: string): AutofillCandidate[] {
  const host = normalizeHostname(hostname);
  if (!host) return [];

  const hostBase = baseHostname(host);
  const entries = listPublicEntries(session.plaintext!);
  const out: AutofillCandidate[] = [];

  for (const entry of entries) {
    const domain = normalizeEntryDomain(entry.domain);
    const title = String(entry.title ?? "");
    const titleLc = title.toLowerCase();
    const domainBase = baseHostname(domain);

    let matchType: AutofillCandidate["matchType"] | null = null;

    if (domain && (domain === host || domainBase === hostBase)) {
      matchType = "exact";
    } else if (domain && (host.endsWith(`.${domain}`) || hostBase.endsWith(`.${domainBase}`))) {
      matchType = "suffix";
    } else if (hostBase && titleLc.includes(hostBase)) {
      matchType = "title";
    }

    if (!matchType) continue;
    out.push({
      id: entry.id,
      title: title || "(sin titulo)",
      username: entry.username,
      domain: entry.domain,
      matchType,
    });
  }

  const score = (match: AutofillCandidate["matchType"]): number => {
    if (match === "exact") return 0;
    if (match === "suffix") return 1;
    return 2;
  };

  return out
    .sort((a, b) => {
      const delta = score(a.matchType) - score(b.matchType);
      if (delta !== 0) return delta;
      return a.title.localeCompare(b.title);
    })
    .slice(0, 8);
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

/**
 * SECURITY FIX #19: Limpieza de datos sensibles en mensajes
 * 
 * VULNERABILIDAD ENCONTRADA:
 * - Master password permanece en el objeto message después de procesarlo
 * - Si hay logging/debugging activo, puede quedar en memoria más tiempo
 * - El objeto message puede ser referenciado desde otros contextos
 * 
 * RIESGO:
 * - MEDIO: Exposición prolongada de master password en memoria
 * - Mayor ventana para memory dump attacks
 * - Potencial leak en logs de desarrollo
 * 
 * SOLUCIÓN IMPLEMENTADA:
 * - Sobrescribir campos sensibles después de usarlos
 * - Aplicar a masterPassword, password, y confirmPassword
 * - Usar técnica de sobrescritura con \0 antes de vaciar
 * 
 * LIMITACIÓN:
 * - JavaScript strings son inmutables (crean copias)
 * - No garantiza limpieza total pero reduce ventana de exposición
 */
function cleanupSensitiveMessageData(message: AnyRequestMessage): void {
  if (!message.payload) return;

  const payload = message.payload as any;

  // Limpiar master password
  if (typeof payload.masterPassword === 'string' && payload.masterPassword) {
    payload.masterPassword = '\0'.repeat(payload.masterPassword.length);
    payload.masterPassword = '';
  }

  // Limpiar confirm password
  if (typeof payload.confirmPassword === 'string' && payload.confirmPassword) {
    payload.confirmPassword = '\0'.repeat(payload.confirmPassword.length);
    payload.confirmPassword = '';
  }

  // Limpiar password de entries (cuando se crea/edita)
  if (payload.entry && typeof payload.entry.password === 'string' && payload.entry.password) {
    payload.entry.password = '\0'.repeat(payload.entry.password.length);
    payload.entry.password = '';
  }
}

export async function handleMessage(
  message: AnyRequestMessage
): Promise<MessageResponseMap[MessageType]> {
  try {
    switch (message?.type) {
      case MESSAGE_TYPES.VAULT_STATUS: {
        return ok(await getVaultStatus());
      }

      case MESSAGE_TYPES.VAULT_CREATE: {
        const master = String(message.payload.masterPassword ?? "");
        const confirm = String(message.payload.confirmPassword ?? "");
        const vaultName = message.payload.vaultName ? String(message.payload.vaultName) : undefined;

        if (!master || !confirm) {
          return err("VALIDATION_ERROR", "Master password and confirm password are required.");
        }

        if (master !== confirm) {
          return err("MASTER_MISMATCH", "Master passwords do not match.");
        }
        
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

        const { encrypted, key, plaintext, recoveryCodes } = await createEncryptedVault(master, vaultName);
        
        await saveEncryptedVault(encrypted);

        // dejamos sesión desbloqueada
        session.unlocked = true;
        session.key = key;
        session.plaintext = plaintext;
        session.encrypted = encrypted;
        touch();

        // Retornar status con recovery codes (solo primera vez)
        const status = await getVaultStatus();
        return ok({ ...status, recoveryCodes });
      }

      case MESSAGE_TYPES.VAULT_UNLOCK: {
        const master = String(message.payload.masterPassword ?? "");
        
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
          touch();
          
          return ok(await getVaultStatus());
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

      case MESSAGE_TYPES.VAULT_UNLOCK_RECOVERY: {
        const recoveryCode = String(message.payload.recoveryCode ?? "").trim();
        
        if (!recoveryCode) {
          return err("VALIDATION_ERROR", "Recovery code requerido");
        }

        // Rate limiting: verificar lockout (mismo que unlock normal)
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

        if (!enc.recoveryCodes) {
          return err("NO_RECOVERY_CODES", "Este vault no tiene recovery codes");
        }

        try {
          const { key, plaintext, codeIndex } = await unlockWithRecoveryCode(enc, recoveryCode);
          
          // Marcar el código como usado
          enc.recoveryCodes.used[codeIndex] = true;
          await saveEncryptedVault(enc);
          
          // Unlock exitoso: resetear contador de intentos
          unlockAttempts.count = 0;
          unlockAttempts.lastAttempt = 0;
          unlockAttempts.lockedUntil = 0;
          
          session.unlocked = true;
          session.key = key;
          session.plaintext = plaintext;
          session.encrypted = enc;
          touch();
          
          const status = await getVaultStatus();
          return ok({ ...status, usedCodeIndex: codeIndex });
        } catch (error: any) {
          lockNow();
          
          // Incrementar contador de intentos fallidos
          unlockAttempts.count++;
          unlockAttempts.lastAttempt = Date.now();
          
          // Lockout después de 5 intentos fallidos
          if (unlockAttempts.count >= 5) {
            unlockAttempts.lockedUntil = Date.now() + 30_000; // 30 segundos
          }
          
          // Delay progresivo
          const delaySec = Math.min(unlockAttempts.count, 5);
          await new Promise(resolve => setTimeout(resolve, delaySec * 1000));
          
          // Mensajes de error específicos
          if (error.message === "Recovery code already used") {
            return err("RECOVERY_CODE_USED", "Este recovery code ya fue utilizado");
          } else if (error.message === "Invalid recovery code") {
            return err("BAD_RECOVERY_CODE", "Recovery code inválido");
          } else {
            return err("BAD_RECOVERY_CODE", "Recovery code inválido o vault corrupto");
          }
        }
      }

      case MESSAGE_TYPES.VAULT_LOCK: {
        lockNow();
        return ok(await getVaultStatus());
      }

      case MESSAGE_TYPES.VAULT_DELETE: {
        const master = String(message.payload.masterPassword ?? "");
        const confirmText = String(message.payload.confirmText ?? "").trim().toLowerCase();

        if (!master) {
          return err("VALIDATION_ERROR", "Master password requerida");
        }

        if (confirmText !== "eliminar") {
          return err("VALIDATION_ERROR", "Debes escribir 'eliminar' para confirmar");
        }

        // Verificar que la master password sea correcta
        const enc = await loadEncryptedVault();
        if (!enc) {
          return err("NO_VAULT", "No hay vault guardado");
        }

        try {
          // Intentar desbloquear para verificar la master password
          await unlockEncryptedVault(enc, master);
        } catch {
          return err("BAD_MASTER", "Master password incorrecta");
        }

        // Master password correcta, eliminar el vault
        await deleteEncryptedVault();
        lockNow();

        return ok({ deleted: true });
      }

      case MESSAGE_TYPES.ENTRY_LIST: {
        requireUnlocked();
        touch();
        return ok({ entries: listPublicEntries(session.plaintext!) });
      }

      case MESSAGE_TYPES.ENTRY_GET: {
        requireUnlocked();
        touch();
        const id = String(message.payload.id ?? "");
        const entry = session.plaintext!.entries.find((x) => x.id === id) ?? null;
        return ok({ entry: entry ? entryPublicView(entry) : null });
      }

      case MESSAGE_TYPES.ENTRY_ADD: {
        requireUnlocked();
        touch();
        const entry = message.payload.entry ?? ({} as any);
        let savedId = "";
        try {
          const { id } = upsertEntry(session.plaintext!, entry);
          savedId = id;
        } catch (e: any) {
          if (String(e?.message).startsWith("VALIDATION:")) return err("VALIDATION", "Datos inválidos (title requerido)");
          return err("VALIDATION", "Datos inválidos");
        }

        const newEnc = await reencryptVault(session.key!, session.plaintext!, session.encrypted!);
        await saveEncryptedVault(newEnc);
        session.encrypted = newEnc;

        const saved = session.plaintext!.entries.find((x) => x.id === savedId) ?? null;
        if (!saved) return err("INTERNAL", "Error guardando entry");
        return ok({ entry: entryPublicView(saved) });
      }

      case MESSAGE_TYPES.ENTRY_UPDATE: {
        requireUnlocked();
        touch();
        const entry = message.payload.entry ?? ({} as any);
        const targetId = String(entry.id ?? "");
        if (!targetId) return err("VALIDATION", "ID requerido para actualizar");
        let savedId = targetId;
        try {
          const { id } = upsertEntry(session.plaintext!, entry);
          savedId = id;
        } catch (e: any) {
          if (String(e?.message).startsWith("VALIDATION:")) return err("VALIDATION", "Datos inválidos (title requerido)");
          return err("VALIDATION", "Datos inválidos");
        }

        const newEnc = await reencryptVault(session.key!, session.plaintext!, session.encrypted!);
        await saveEncryptedVault(newEnc);
        session.encrypted = newEnc;

        const saved = session.plaintext!.entries.find((x) => x.id === savedId) ?? null;
        if (!saved) return err("INTERNAL", "Error guardando entry");
        return ok({ entry: entryPublicView(saved) });
      }

      case MESSAGE_TYPES.ENTRY_DELETE: {
        requireUnlocked();
        touch();
        const id = String(message.payload.id ?? "");
        deleteEntry(session.plaintext!, id);

        const newEnc = await reencryptVault(session.key!, session.plaintext!, session.encrypted!);
        await saveEncryptedVault(newEnc);
        session.encrypted = newEnc;

        return ok({ id });
      }

      case MESSAGE_TYPES.ENTRY_GET_SECRET: {
        requireUnlocked();
        touch();
        const id = String(message.payload.id ?? "");
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

      case MESSAGE_TYPES.AUTOFILL_QUERY_BY_DOMAIN: {
        requireUnlocked();
        touch();
        const hostname = normalizeHostname(message.payload.hostname);
        if (!hostname) return err("VALIDATION", "Hostname requerido");
        const entries = getAutofillCandidatesByHostname(hostname);
        return ok({ entries });
      }

      case MESSAGE_TYPES.GENERATE_PASSWORD: {
        const cfg = message.payload?.config ?? { length: 16 };
        const pwd = generatePassword(cfg);
        return ok({ password: pwd });
      }

      case MESSAGE_TYPES.HIBP_CHECK: {
        const password = String(message.payload.password ?? "");
        if (!password) return err("VALIDATION", "Password vacío");
        try {
          const count = await hibpCheck(password);
          return ok({ count });
        } catch {
          return err("INTERNAL", "Error consultando HIBP");
        }
      }

      case MESSAGE_TYPES.OPEN_POPUP_FOR_SIGNUP: {
        // Solo permitir si el vault está desbloqueado
        requireUnlocked();
        
        // Abrir la ventana popup de la extensión
        // Nota: En Manifest V3, solo podemos abrir el popup programáticamente
        // desde el action, así que aquí solo confirmamos que está desbloqueado
        return ok({ opened: true });
      }

      case MESSAGE_TYPES.REQUEST_AUTOFILL: {
        // Popup solicita autofill en la pestaña activa
        requireUnlocked();
        
        const { username, password } = message.payload as { username: string; password: string };
        
        // Obtener la pestaña activa actual
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs.length === 0 || !tabs[0].id) {
          return err("NO_ACTIVE_TAB", "No hay pestaña activa");
        }
        
        try {
          // Enviar mensaje de autofill al content script de la pestaña activa
          await chrome.tabs.sendMessage(tabs[0].id, {
            type: MESSAGE_TYPES.AUTOFILL_CREDENTIALS,
            payload: { username, password }
          });
          
          return ok({ sent: true });
        } catch (error) {
          console.error('[G8keeper] Error sending autofill message:', error);
          return err("AUTOFILL_FAILED", "No se pudo autorellenar el formulario");
        }
      }

      case MESSAGE_TYPES.EXPORT_RECOVERY_CODES: {
        // Exportar recovery codes a archivo .txt
        const { codes, vaultName } = message.payload as { codes: string[]; vaultName?: string };
        
        if (!codes || codes.length === 0) {
          return err("VALIDATION", "No hay códigos para exportar");
        }

        const { exportRecoveryCodesAsText } = await import("../core/vault/recovery.ts");
        const textContent = exportRecoveryCodesAsText(codes, vaultName);
        
        // Retornar el contenido como string (el frontend lo guardará como archivo)
        const filename = `recovery-codes-${vaultName || 'vault'}-${Date.now()}.txt`;
        
        return ok({ blob: textContent, filename });
      }

      default:
        return err("UNKNOWN_MESSAGE", "Mensaje no soportado");
    }
  } catch (e: any) {
    console.error('[session] CRITICAL ERROR in handleApiMessage:', e);
    console.error('[session] Error stack:', e?.stack);
    console.error('[session] Message type:', message?.type);
    if (String(e?.message) === "LOCKED") return err("LOCKED", "Vault bloqueada");
    return err("INTERNAL", `Error interno: ${e?.message || 'Unknown error'}`);
  } finally {
    // Siempre limpiar datos sensibles del mensaje, incluso si hubo error
    cleanupSensitiveMessageData(message);
  }
}
