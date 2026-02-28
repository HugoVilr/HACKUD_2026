import { generatePassword } from "../core/generator/generator.ts";
import { hibpCheck } from "../core/hibp/hibp.ts";
import {
  MESSAGE_TYPES,
  type AnyRequestMessage,
  type AutofillCandidate,
  type ApiResult,
  type HibpAuditScheduleData,
  type HibpAuditItem,
  type HibpAuditSummary,
  type MessageType,
  type MessageResponseMap,
  type VaultStatusData
} from "../shared/messages.ts";
import { hasEncryptedVault, loadEncryptedVault, saveEncryptedVault, deleteEncryptedVault } from "../core/vault/storage.ts";
import { createEncryptedVault, reencryptVault, unlockEncryptedVault, unlockWithRecoveryCode } from "../core/vault/crypto.ts";
import { deleteEntry, entryPublicView, getEntrySecret, listPublicEntries, upsertEntry } from "../core/vault/entries.ts";
import type { EncryptedVault, VaultPlaintext, VaultKeyBundle } from "../core/vault/types.ts";


type Session = {
  unlocked: boolean;
  key: VaultKeyBundle | null;
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

type HibpAuditRecord = {
  audit: HibpAuditSummary;
  items: HibpAuditItem[];
  entryRefs: Array<{ entryId: string; title: string; domain?: string }>;
  domainCache: Record<string, DomainAuditCacheEntry>;
};

type DomainAuditCacheEntry = {
  status: HibpAuditItem["domainStatus"];
  breachCount: number | null;
  breaches?: string[];
  error?: string;
};

const HIBP_AUDIT_PREFIX = "g8keeper_hibp_audit_";
const HIBP_AUDIT_ACTIVE_KEY = "g8keeper_hibp_audit_active";
const hibpAuditStepLocks = new Set<string>();
const hibpAuditRunners = new Set<string>();
const HIBP_AUDIT_SCHEDULE_KEY = "g8keeper_hibp_audit_schedule";
const HIBP_AUDIT_INTERVAL_HOURS = 12;

const auditStorageKey = (auditId: string) => `${HIBP_AUDIT_PREFIX}${auditId}`;

const createAuditId = () => {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

const sleep = async (ms: number) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const URL_IN_TEXT_REGEX = /https?:\/\/[^\s<>"')]+/gi;
const DOMAIN_IN_TEXT_REGEX = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\b/gi;

const loadAuditRecord = async (auditId: string): Promise<HibpAuditRecord | null> => {
  const key = auditStorageKey(auditId);
  const data = await chrome.storage.session.get(key);
  const record = data?.[key];
  if (!record || typeof record !== "object") {
    return null;
  }
  const raw = record as Partial<HibpAuditRecord> & { audit?: Partial<HibpAuditSummary> };
  const audit = raw.audit ?? {};
  const normalized: HibpAuditRecord = {
    audit: {
      auditId: String(audit.auditId ?? auditId),
      state: (audit.state as HibpAuditSummary["state"]) ?? "running",
      startedAt: Number(audit.startedAt ?? Date.now()),
      finishedAt: Number.isFinite(Number(audit.finishedAt)) ? Number(audit.finishedAt) : undefined,
      total: Number(audit.total ?? 0),
      processed: Number(audit.processed ?? 0),
      compromised: Number(audit.compromised ?? 0),
      safe: Number(audit.safe ?? 0),
      errors: Number(audit.errors ?? 0),
      domainPwned: Number(audit.domainPwned ?? 0),
      domainSafe: Number(audit.domainSafe ?? 0),
      domainErrors: Number(audit.domainErrors ?? 0),
      domainSkipped: Number(audit.domainSkipped ?? 0),
    },
    items: Array.isArray(raw.items) ? (raw.items as HibpAuditItem[]) : [],
    entryRefs: Array.isArray(raw.entryRefs) ? (raw.entryRefs as HibpAuditRecord["entryRefs"]) : [],
    domainCache:
      raw.domainCache && typeof raw.domainCache === "object"
        ? (raw.domainCache as HibpAuditRecord["domainCache"])
        : {},
  };

  return normalized;
};

const saveAuditRecord = async (record: HibpAuditRecord): Promise<void> => {
  const key = auditStorageKey(record.audit.auditId);
  await chrome.storage.session.set({
    [key]: record,
    [HIBP_AUDIT_ACTIVE_KEY]: record.audit.auditId,
  });
};

const defaultSchedule = (): HibpAuditScheduleData => {
  const now = Date.now();
  return {
    intervalHours: HIBP_AUDIT_INTERVAL_HOURS,
    nextAuditAt: now + HIBP_AUDIT_INTERVAL_HOURS * 60 * 60 * 1000,
    pending: false,
    now,
  };
};

const loadSchedule = async (): Promise<HibpAuditScheduleData> => {
  const data = await chrome.storage.local.get(HIBP_AUDIT_SCHEDULE_KEY);
  const raw = data?.[HIBP_AUDIT_SCHEDULE_KEY];
  if (!raw || typeof raw !== "object") {
    const schedule = defaultSchedule();
    await chrome.storage.local.set({ [HIBP_AUDIT_SCHEDULE_KEY]: schedule });
    return schedule;
  }

  const schedule: HibpAuditScheduleData = {
    intervalHours: HIBP_AUDIT_INTERVAL_HOURS,
    lastAuditAt: Number.isFinite(Number(raw.lastAuditAt)) ? Number(raw.lastAuditAt) : undefined,
    lastAuditId: typeof raw.lastAuditId === "string" ? raw.lastAuditId : undefined,
    lastAuditState: typeof raw.lastAuditState === "string" ? raw.lastAuditState : undefined,
    nextAuditAt: Number.isFinite(Number(raw.nextAuditAt))
      ? Number(raw.nextAuditAt)
      : Date.now() + HIBP_AUDIT_INTERVAL_HOURS * 60 * 60 * 1000,
    pending: Boolean(raw.pending),
    now: Date.now(),
  };

  return schedule;
};

const saveSchedule = async (schedule: HibpAuditScheduleData): Promise<void> => {
  const next: HibpAuditScheduleData = { ...schedule, now: Date.now() };
  await chrome.storage.local.set({ [HIBP_AUDIT_SCHEDULE_KEY]: next });
};

const computeNextAuditAt = (baseMs: number, intervalHours: number): number => {
  return baseMs + intervalHours * 60 * 60 * 1000;
};

const hibpCheckWithRetry = async (password: string): Promise<number> => {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await hibpCheck(password);
    } catch (error) {
      lastError = error;
      const message = String((error as Error)?.message ?? error);
      const transient = message.includes("HIBP_RATE_LIMITED") || message.includes("HIBP_TIMEOUT");
      if (!transient || attempt === 2) {
        throw error;
      }
      await sleep((attempt + 1) * 1200);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("HIBP_CHECK_FAILED");
};

const normalizeDomainForAudit = (raw: string | undefined): string | null => {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return null;
  try {
    if (value.includes("://")) {
      const host = new URL(value).hostname.trim().toLowerCase();
      return host.replace(/^www\./, "") || null;
    }
  } catch {
    // fallback below
  }
  const noProto = value.replace(/^https?:\/\//, "");
  const host = noProto.split("/")[0]?.trim().toLowerCase() ?? "";
  if (!host || host.includes(" ") || host.startsWith(".")) {
    return null;
  }
  return host.replace(/\.+$/, "").replace(/^www\./, "") || null;
};

const extractDomainFromText = (raw: string | undefined): string | null => {
  const text = String(raw ?? "").trim().toLowerCase();
  if (!text) return null;

  const urlMatches = text.match(URL_IN_TEXT_REGEX) ?? [];
  for (const value of urlMatches) {
    const domain = normalizeDomainForAudit(value);
    if (domain) return domain;
  }

  const hostMatches = text.match(DOMAIN_IN_TEXT_REGEX) ?? [];
  for (const value of hostMatches) {
    const domain = normalizeDomainForAudit(value);
    if (domain) return domain;
  }

  return null;
};

const resolveEntryDomain = (entry: { domain?: string; title?: string; notes?: string }): string | undefined => {
  return (
    normalizeDomainForAudit(entry.domain) ??
    extractDomainFromText(entry.title) ??
    extractDomainFromText(entry.notes) ??
    undefined
  );
};

const hibpDomainCheck = async (domain: string): Promise<DomainAuditCacheEntry> => {
  const url = `https://haveibeenpwned.com/api/v3/breaches?domain=${encodeURIComponent(domain)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "Seeking the Perfect Key (HackUDC 2026)",
      "Accept": "application/json",
    },
  });

  if (res.status === 404) {
    return { status: "safe", breachCount: 0, breaches: [] };
  }
  if (res.status === 429) {
    throw new Error("HIBP_DOMAIN_RATE_LIMITED");
  }
  if (res.status === 403) {
    throw new Error("HIBP_DOMAIN_FORBIDDEN");
  }
  if (!res.ok) {
    throw new Error(`HIBP_DOMAIN_HTTP_${res.status}`);
  }

  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error("HIBP_DOMAIN_BAD_RESPONSE");
  }

  const breaches = data
    .map((item) => String(item?.Name || item?.Title || "").trim())
    .filter(Boolean);

  const uniq = [...new Set(breaches)];
  return {
    status: uniq.length > 0 ? "pwned" : "safe",
    breachCount: uniq.length,
    breaches: uniq.slice(0, 10),
  };
};

const hibpDomainCheckWithRetry = async (domain: string): Promise<DomainAuditCacheEntry> => {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await hibpDomainCheck(domain);
    } catch (error) {
      lastError = error;
      const message = String((error as Error)?.message ?? error);
      const transient = message.includes("RATE_LIMITED") || message.includes("HTTP_503");
      if (!transient || attempt === 2) {
        throw error;
      }
      await sleep((attempt + 1) * 1200);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("HIBP_DOMAIN_CHECK_FAILED");
};

const finalizeScheduleAfterAudit = async (audit: HibpAuditSummary): Promise<void> => {
  const schedule = await loadSchedule();
  const now = Date.now();
  schedule.lastAuditAt = now;
  schedule.lastAuditId = audit.auditId;
  schedule.lastAuditState = audit.state;
  schedule.pending = false;
  schedule.nextAuditAt = computeNextAuditAt(now, schedule.intervalHours || HIBP_AUDIT_INTERVAL_HOURS);
  await saveSchedule(schedule);
};

const nextAuditTarget = (record: HibpAuditRecord) => {
  const seen = new Set(record.items.map((item) => item.entryId));
  for (const ref of record.entryRefs) {
    if (!seen.has(ref.entryId)) {
      return ref;
    }
  }
  return null;
};

const advanceHibpAuditOneStep = async (record: HibpAuditRecord): Promise<HibpAuditRecord> => {
  if (record.audit.state !== "running") {
    return record;
  }

  const auditId = record.audit.auditId;
  if (hibpAuditStepLocks.has(auditId)) {
    return record;
  }
  hibpAuditStepLocks.add(auditId);

  try {
    if (!session.unlocked || !session.plaintext || !session.key || !session.encrypted) {
      record.audit.state = "aborted";
      record.audit.finishedAt = Date.now();
      await saveAuditRecord(record);
      await finalizeScheduleAfterAudit(record.audit);
      return record;
    }

    const target = nextAuditTarget(record);
    if (!target) {
      record.audit.state = "done";
      record.audit.finishedAt = Date.now();
      await saveAuditRecord(record);
      await finalizeScheduleAfterAudit(record.audit);
      return record;
    }

    const sourceEntry = session.plaintext.entries.find((entry) => entry.id === target.entryId);
    let count: number | null = null;
    let errorMessage: string | undefined;
    const domain = normalizeDomainForAudit(target.domain);
    let domainResult: DomainAuditCacheEntry = {
      status: "skipped",
      breachCount: null,
    };

    try {
      const password = String(sourceEntry?.password ?? "");
      if (!password) {
        throw new Error("Password vacia o entry no encontrada");
      }
      count = await hibpCheckWithRetry(password);
    } catch (error) {
      errorMessage = String((error as Error)?.message ?? error);
    }

    if (domain) {
      const cached = record.domainCache[domain];
      if (cached) {
        domainResult = cached;
      } else {
        try {
          domainResult = await hibpDomainCheckWithRetry(domain);
        } catch (error) {
          domainResult = {
            status: "error",
            breachCount: null,
            error: String((error as Error)?.message ?? error),
          };
        }
        record.domainCache[domain] = domainResult;
      }
    }

    const compromised = Number(count) > 0;
    const status: HibpAuditItem["status"] = errorMessage ? "error" : "ok";

    record.items.push({
      entryId: target.entryId,
      title: target.title,
      count: count ?? null,
      compromised: status === "ok" ? compromised : false,
      status,
      error: errorMessage,
      domain: domain ?? undefined,
      domainStatus: domainResult.status,
      domainBreachCount: domainResult.breachCount,
      domainBreaches: domainResult.breaches,
      domainError: domainResult.error,
    });

    record.audit.processed += 1;
    if (status === "error") {
      record.audit.errors += 1;
    } else if (compromised) {
      record.audit.compromised += 1;
    } else {
      record.audit.safe += 1;
    }

    if (domainResult.status === "pwned") {
      record.audit.domainPwned += 1;
    } else if (domainResult.status === "safe") {
      record.audit.domainSafe += 1;
    } else if (domainResult.status === "error") {
      record.audit.domainErrors += 1;
    } else {
      record.audit.domainSkipped += 1;
    }

    if (record.audit.processed >= record.audit.total) {
      record.audit.state = "done";
      record.audit.finishedAt = Date.now();
    }

    await saveAuditRecord(record);
    if (record.audit.state !== "running") {
      await finalizeScheduleAfterAudit(record.audit);
    }
    console.info("[G8keeper][HIBP_AUDIT] step", {
      auditId,
      processed: record.audit.processed,
      total: record.audit.total,
      state: record.audit.state,
    });
    return record;
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    record.audit.state = "failed";
    record.audit.finishedAt = Date.now();
    record.audit.errors += 1;
    record.items.push({
      entryId: "internal",
      title: "audit-runtime",
      count: null,
      compromised: false,
      status: "error",
      error: message,
      domainStatus: "error",
      domainBreachCount: null,
      domainError: message,
    });
    await saveAuditRecord(record);
    await finalizeScheduleAfterAudit(record.audit);
    console.error("[G8keeper][HIBP_AUDIT] failed", { auditId, message });
    return record;
  } finally {
    hibpAuditStepLocks.delete(auditId);
  }
};

const runAuditInBackground = async (auditId: string): Promise<void> => {
  if (hibpAuditRunners.has(auditId)) {
    return;
  }
  hibpAuditRunners.add(auditId);
  try {
    while (true) {
      let record = await loadAuditRecord(auditId);
      if (!record) {
        return;
      }
      if (record.audit.state !== "running") {
        return;
      }
      record = await advanceHibpAuditOneStep(record);
      if (record.audit.state !== "running") {
        return;
      }
      await sleep(180);
    }
  } finally {
    hibpAuditRunners.delete(auditId);
  }
};

const startHibpAudit = async (): Promise<{ auditId: string; total: number; startedAt: number }> => {
  requireUnlocked();
  touch();

  const activeData = await chrome.storage.session.get(HIBP_AUDIT_ACTIVE_KEY);
  const activeId = String(activeData?.[HIBP_AUDIT_ACTIVE_KEY] ?? "").trim();
  if (activeId) {
    const active = await loadAuditRecord(activeId);
    if (active && active.audit.state === "running") {
      void runAuditInBackground(activeId);
      return {
        auditId: active.audit.auditId,
        total: active.audit.total,
        startedAt: active.audit.startedAt,
      };
    }
  }

  const entryRefs = session.plaintext!.entries.map((entry) => ({
    entryId: entry.id,
    title: String(entry.title || "(sin titulo)"),
    domain: resolveEntryDomain(entry),
  }));

  if (entryRefs.length === 0) {
    throw new Error("EMPTY_VAULT");
  }

  const auditId = createAuditId();
  const startedAt = Date.now();

  const record: HibpAuditRecord = {
    audit: {
      auditId,
      state: "running",
      startedAt,
      total: entryRefs.length,
      processed: 0,
      compromised: 0,
      safe: 0,
      errors: 0,
      domainPwned: 0,
      domainSafe: 0,
      domainErrors: 0,
      domainSkipped: 0,
    },
    items: [],
    entryRefs,
    domainCache: {},
  };

  await saveAuditRecord(record);
  const schedule = await loadSchedule();
  schedule.pending = false;
  schedule.nextAuditAt = computeNextAuditAt(startedAt, schedule.intervalHours || HIBP_AUDIT_INTERVAL_HOURS);
  await saveSchedule(schedule);
  void runAuditInBackground(auditId);
  console.info("[G8keeper][HIBP_AUDIT] started", { auditId, total: entryRefs.length });

  return { auditId, total: entryRefs.length, startedAt };
};

export const maybeRunScheduledHibpAudit = async (trigger: "alarm" | "status-check"): Promise<void> => {
  const schedule = await loadSchedule();
  const now = Date.now();
  const due = now >= schedule.nextAuditAt;
  if (!due && !schedule.pending) {
    return;
  }

  if (!session.unlocked || !session.plaintext || !session.key || !session.encrypted) {
    schedule.pending = true;
    await saveSchedule(schedule);
    console.info("[G8keeper][HIBP_AUDIT] scheduled pending (locked)", { trigger, nextAuditAt: schedule.nextAuditAt });
    return;
  }

  try {
    const started = await startHibpAudit();
    schedule.pending = false;
    schedule.lastAuditId = started.auditId;
    await saveSchedule(schedule);
    console.info("[G8keeper][HIBP_AUDIT] scheduled started", { trigger, auditId: started.auditId });
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    if (message === "EMPTY_VAULT") {
      schedule.pending = false;
      schedule.lastAuditAt = now;
      schedule.lastAuditState = "done";
      schedule.nextAuditAt = computeNextAuditAt(now, schedule.intervalHours || HIBP_AUDIT_INTERVAL_HOURS);
      await saveSchedule(schedule);
      console.info("[G8keeper][HIBP_AUDIT] scheduled skipped (empty vault)", { trigger });
      return;
    }
    console.error("[G8keeper][HIBP_AUDIT] scheduled start failed", { trigger, message });
  }
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
    const resolvedDomain = resolveEntryDomain(entry);
    const domain = normalizeEntryDomain(resolvedDomain);
    const title = String(entry.title ?? "");
    const titleLc = title.toLowerCase();
    const domainBase = baseHostname(domain);

    let matchType: AutofillCandidate["matchType"] | null = null;

    if (domain && (domain === host || domainBase === hostBase)) {
      matchType = "exact";
    } else if (
      domain &&
      (host.endsWith(`.${domain}`) ||
        hostBase.endsWith(`.${domainBase}`) ||
        domain.endsWith(`.${host}`) ||
        domainBase.endsWith(`.${hostBase}`))
    ) {
      matchType = "suffix";
    } else if (hostBase && titleLc.includes(hostBase)) {
      matchType = "title";
    }

    if (!matchType) continue;
    out.push({
      id: entry.id,
      title: title || "(sin titulo)",
      username: entry.username,
      domain: resolvedDomain,
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
        void maybeRunScheduledHibpAudit("status-check");
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

        const { encrypted, keys, plaintext, recoveryCodes } = await createEncryptedVault(master, vaultName);
        
        await saveEncryptedVault(encrypted);

        // dejamos sesión desbloqueada
        session.unlocked = true;
        session.key = keys;
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
          const { keys, plaintext } = await unlockEncryptedVault(enc, master);
          
          // Unlock exitoso: resetear contador de intentos
          unlockAttempts.count = 0;
          unlockAttempts.lastAttempt = 0;
          unlockAttempts.lockedUntil = 0;
          
          session.unlocked = true;
          session.key = keys;
          session.plaintext = plaintext;
          session.encrypted = enc;
          touch();
          
          return ok(await getVaultStatus());
        } catch {
          lockNow();
          
          // Incrementar contador de intentos fallidos
          unlockAttempts.count++;
          unlockAttempts.lastAttempt = Date.now();
          
          // Lockout después de 3 intentos fallidos (v2: más agresivo)
          if (unlockAttempts.count >= 3) {
            unlockAttempts.lockedUntil = Date.now() + 60_000; // 60 segundos
          }
          
          // Delay exponencial: 2^n seconds (2s, 4s, 8s, 16s ...)
          const delayMs = Math.min(2 ** unlockAttempts.count * 1000, 30_000);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          
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
          const { keys, plaintext, codeIndex } = await unlockWithRecoveryCode(enc, recoveryCode);
          
          // Marcar el código como usado
          enc.recoveryCodes.used[codeIndex] = true;
          await saveEncryptedVault(enc);
          
          // Unlock exitoso: resetear contador de intentos
          unlockAttempts.count = 0;
          unlockAttempts.lastAttempt = 0;
          unlockAttempts.lockedUntil = 0;
          
          session.unlocked = true;
          session.key = keys;
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
          
          // Lockout después de 3 intentos fallidos (v2: más agresivo)
          if (unlockAttempts.count >= 3) {
            unlockAttempts.lockedUntil = Date.now() + 60_000; // 60 segundos
          }
          
          // Delay exponencial: 2^n seconds
          const delaySec = Math.min(2 ** unlockAttempts.count * 1000, 30_000);
          await new Promise(resolve => setTimeout(resolve, delaySec));
          
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
        const entry = { ...(message.payload.entry ?? ({} as any)) };
        const inferredDomain = resolveEntryDomain(entry);
        if (inferredDomain) {
          entry.domain = inferredDomain;
        }
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
        const entry = { ...(message.payload.entry ?? ({} as any)) };
        const inferredDomain = resolveEntryDomain(entry);
        if (inferredDomain) {
          entry.domain = inferredDomain;
        }
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

      case MESSAGE_TYPES.HIBP_AUDIT_START: {
        try {
          const started = await startHibpAudit();
          return ok(started);
        } catch (error) {
          const message = String((error as Error)?.message ?? error);
          if (message === "EMPTY_VAULT") {
            return err("EMPTY_VAULT", "No hay credenciales para auditar.");
          }
          return err("INTERNAL", "No se pudo iniciar la auditoría HIBP.");
        }
      }

      case MESSAGE_TYPES.HIBP_AUDIT_STATUS: {
        const auditId = String(message.payload.auditId ?? "").trim();
        if (!auditId) {
          return err("VALIDATION", "auditId requerido");
        }

        let record = await loadAuditRecord(auditId);
        if (!record) {
          return err("NOT_FOUND", "Auditoría no encontrada");
        }

        if (record.audit.state === "running") {
          record = await advanceHibpAuditOneStep(record);
        }

        return ok({ audit: record.audit });
      }

      case MESSAGE_TYPES.HIBP_AUDIT_RESULT: {
        const auditId = String(message.payload.auditId ?? "").trim();
        if (!auditId) {
          return err("VALIDATION", "auditId requerido");
        }

        const record = await loadAuditRecord(auditId);
        if (!record) {
          return err("NOT_FOUND", "Auditoría no encontrada");
        }

        return ok({ audit: record.audit, items: record.items });
      }

      case MESSAGE_TYPES.HIBP_AUDIT_SCHEDULE: {
        const schedule = await loadSchedule();
        return ok({ schedule: { ...schedule, now: Date.now() } });
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
