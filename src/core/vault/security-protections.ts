/**
 * ADVANCED SECURITY PROTECTIONS
 * 
 * Este módulo implementa protecciones adicionales de seguridad para el vault:
 * 
 * 1. RATE LIMITING & BRUTE FORCE PROTECTION
 *    - Límite de intentos fallidos
 *    - Exponential backoff
 *    - Account lockout temporal
 * 
 * 2. ANTI-FORENSICS
 *    - Secure memory wiping
 *    - Timing obfuscation
 *    - Decoy data generation
 * 
 * 3. SECURITY MONITORING
 *    - Audit logging
 *    - Anomaly detection
 *    - Security events tracking
 * 
 * 4. ADDITIONAL HARDENING
 *    - Password strength enforcement
 *    - Secure random generation
 *    - Key rotation policies
 * 
 * @author HACKUD 2026 - Maximum Security Edition
 */

import { nowIso } from "../../shared/time.ts";

const te = new TextEncoder();
const td = new TextDecoder();

/**
 * RATE LIMITER: Protección contra brute force
 * 
 * Implementa:
 * - Límite de intentos por período de tiempo
 * - Exponential backoff (1s, 2s, 4s, 8s, 16s, 30s, 60s...)
 * - Account lockout después de N intentos
 * - Auto-reset después de período de éxito
 */
export class RateLimiter {
  private attempts: Map<string, {
    count: number;
    firstAttemptTime: number;
    lastAttemptTime: number;
    nextAllowedTime: number;
  }> = new Map();
  
  private readonly maxAttempts: number = 10;
  private readonly timeWindowMs: number = 15 * 60 * 1000; // 15 minutos
  private readonly lockoutDurationMs: number = 30 * 60 * 1000; // 30 minutos
  
  /**
   * Verifica si un intento está permitido
   * @param identifier Identificador único (ej: vault ID, username)
   * @returns true si permitido, false si bloqueado
   */
  async checkAttempt(identifier: string): Promise<{
    allowed: boolean;
    remainingAttempts?: number;
    waitTimeMs?: number;
    reason?: string;
  }> {
    const now = Date.now();
    const record = this.attempts.get(identifier);
    
    if (!record) {
      // Primer intento
      return { allowed: true, remainingAttempts: this.maxAttempts };
    }
    
    // Verificar si aún está en lockout
    if (record.nextAllowedTime > now) {
      return {
        allowed: false,
        waitTimeMs: record.nextAllowedTime - now,
        reason: 'Too many failed attempts - account temporarily locked',
      };
    }
    
    // Verificar si la ventana de tiempo expiró (reset)
    if (now - record.firstAttemptTime > this.timeWindowMs) {
      // Reset después de ventana de tiempo
      this.attempts.delete(identifier);
      return { allowed: true, remainingAttempts: this.maxAttempts };
    }
    
    // Calcular intentos restantes
    const remaining = this.maxAttempts - record.count;
    
    if (remaining <= 0) {
      // Máximo alcanzado - lockout
      const lockoutUntil = now + this.lockoutDurationMs;
      record.nextAllowedTime = lockoutUntil;
      
      return {
        allowed: false,
        waitTimeMs: this.lockoutDurationMs,
        reason: 'Maximum attempts exceeded - locked out',
      };
    }
    
    return {
      allowed: true,
      remainingAttempts: remaining,
    };
  }
  
  /**
   * Registra un intento fallido
   */
  async recordFailedAttempt(identifier: string): Promise<void> {
    const now = Date.now();
    const record = this.attempts.get(identifier);
    
    if (!record) {
      // Primer fallo
      this.attempts.set(identifier, {
        count: 1,
        firstAttemptTime: now,
        lastAttemptTime: now,
        nextAllowedTime: 0,
      });
      return;
    }
    
    // Incrementar contador
    record.count++;
    record.lastAttemptTime = now;
    
    // Calcular exponential backoff
    const backoffMs = Math.min(
      1000 * Math.pow(2, record.count - 1), // 1s, 2s, 4s, 8s...
      60000 // Máximo 60s
    );
    
    record.nextAllowedTime = now + backoffMs;
    
    console.warn(`[SECURITY] Failed attempt ${record.count}/${this.maxAttempts} for ${identifier}`);
  }
  
  /**
   * Registra un intento exitoso (reset)
   */
  async recordSuccessfulAttempt(identifier: string): Promise<void> {
    this.attempts.delete(identifier);
    console.log(`[SECURITY] Successful unlock for ${identifier} - rate limit reset`);
  }
  
  /**
   * Obtiene estadísticas de intentos
   */
  getStats(identifier: string): {
    attempts: number;
    isLocked: boolean;
    lockoutEndsAt?: Date;
  } | null {
    const record = this.attempts.get(identifier);
    if (!record) return null;
    
    const now = Date.now();
    const isLocked = record.nextAllowedTime > now;
    
    return {
      attempts: record.count,
      isLocked,
      lockoutEndsAt: isLocked ? new Date(record.nextAllowedTime) : undefined,
    };
  }
  
  /**
   * Limpia registros antiguos (cleanup)
   */
  cleanup(): void {
    const now = Date.now();
    const expiredTime = this.timeWindowMs + this.lockoutDurationMs;
    
    for (const [identifier, record] of this.attempts.entries()) {
      if (now - record.lastAttemptTime > expiredTime) {
        this.attempts.delete(identifier);
      }
    }
  }
}

/**
 * PASSWORD STRENGTH ENFORCER
 * 
 * Valida y calcula fuerza de passwords según múltiples criterios
 */
export class PasswordStrengthEnforcer {
  private readonly minLength = 12;
  private readonly minLengthQuantum = 16; // Quantum vaults requieren más
  
  /**
   * Calcula la entropía de un password
   */
  calculateEntropy(password: string): number {
    const hasLower = /[a-z]/.test(password);
    const hasUpper = /[A-Z]/.test(password);
    const hasDigit = /[0-9]/.test(password);
    const hasSymbol = /[^a-zA-Z0-9]/.test(password);
    
    let poolSize = 0;
    if (hasLower) poolSize += 26;
    if (hasUpper) poolSize += 26;
    if (hasDigit) poolSize += 10;
    if (hasSymbol) poolSize += 33; // Símbolos comunes
    
    // Entropía = log2(poolSize^length)
    const entropy = password.length * Math.log2(poolSize);
    
    return entropy;
  }
  
  /**
   * Valida un password y retorna score + recomendaciones
   */
  validatePassword(
    password: string,
    isQuantumVault: boolean = false
  ): {
    valid: boolean;
    score: number; // 0-100
    entropy: number;
    issues: string[];
    recommendations: string[];
  } {
    const issues: string[] = [];
    const recommendations: string[] = [];
    
    const minLen = isQuantumVault ? this.minLengthQuantum : this.minLength;
    
    // Verificar longitud mínima
    if (password.length < minLen) {
      issues.push(`Password must be at least ${minLen} characters`);
    }
    
    // Verificar complejidad
    const hasLower = /[a-z]/.test(password);
    const hasUpper = /[A-Z]/.test(password);
    const hasDigit = /[0-9]/.test(password);
    const hasSymbol = /[^a-zA-Z0-9]/.test(password);
    
    if (!hasLower) issues.push('Missing lowercase letters');
    if (!hasUpper) issues.push('Missing uppercase letters');
    if (!hasDigit) issues.push('Missing digits');
    if (!hasSymbol) {
      issues.push('Missing symbols');
      recommendations.push('Add symbols for extra security: !@#$%^&*()');
    }
    
    // Verificar patrones comunes
    const commonPatterns = [
      /^[a-z]+$/i, // Solo letras
      /^[0-9]+$/, // Solo números
      /password/i,
      /123456/,
      /qwerty/i,
      /abc123/i,
      /(.)\1{2,}/, // Caracteres repetidos (aaa, 111)
    ];
    
    for (const pattern of commonPatterns) {
      if (pattern.test(password)) {
        issues.push('Password contains common patterns');
        recommendations.push('Avoid common words and sequential patterns');
        break;
      }
    }
    
    // Calcular score
    const entropy = this.calculateEntropy(password);
    let score = Math.min(100, (entropy / 100) * 100); // 100 bits = score 100
    
    // Penalizar por issues
    score -= issues.length * 10;
    score = Math.max(0, score);
    
    // Recomendaciones basadas en score
    if (score < 50) {
      recommendations.push('Consider using a passphrase (4+ random words)');
      recommendations.push('Use a password manager to generate strong passwords');
    }
    
    if (isQuantumVault && entropy < 80) {
      recommendations.push('Quantum vaults require >= 80 bits entropy (very strong password)');
    }
    
    return {
      valid: issues.length === 0 && password.length >= minLen,
      score: Math.round(score),
      entropy: Math.round(entropy),
      issues,
      recommendations,
    };
  }
  
  /**
   * Genera un password fuerte aleatorio
   */
  generateStrongPassword(length: number = 20, includeSymbols: boolean = true): string {
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const digits = '0123456789';
    const symbols = '!@#$%^&*()_+-={}[]|:;<>,.?/~';
    
    let charset = lowercase + uppercase + digits;
    if (includeSymbols) charset += symbols;
    
    const randomBytes = new Uint8Array(length);
    crypto.getRandomValues(randomBytes);
    
    let password = '';
    for (let i = 0; i < length; i++) {
      password += charset[randomBytes[i] % charset.length];
    }
    
    // Asegurar que tiene al menos uno de cada tipo
    const hasLower = /[a-z]/.test(password);
    const hasUpper = /[A-Z]/.test(password);
    const hasDigit = /[0-9]/.test(password);
    
    if (!hasLower || !hasUpper || !hasDigit) {
      // Regenerar si no cumple requisitos
      return this.generateStrongPassword(length, includeSymbols);
    }
    
    return password;
  }
}

/**
 * SECURITY AUDIT LOGGER
 * 
 * Registra eventos de seguridad para análisis y forense
 */
export interface SecurityEvent {
  timestamp: string;
  eventType: 'unlock_success' | 'unlock_failure' | 'vault_created' | 'vault_modified' | 
             'recovery_used' | 'rate_limit_hit' | 'integrity_check' | 'suspicious_activity';
  severity: 'info' | 'warning' | 'critical';
  vaultId?: string;
  details: Record<string, any>;
  clientInfo?: {
    userAgent?: string;
    platform?: string;
    timestamp: number;
  };
}

export class SecurityAuditLogger {
  private events: SecurityEvent[] = [];
  private readonly maxEvents = 1000; // Límite de eventos en memoria
  
  /**
   * Registra un evento de seguridad
   */
  log(event: Omit<SecurityEvent, 'timestamp' | 'clientInfo'>): void {
    const fullEvent: SecurityEvent = {
      ...event,
      timestamp: nowIso(),
      clientInfo: {
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
        platform: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
        timestamp: Date.now(),
      },
    };
    
    this.events.push(fullEvent);
    
    // Mantener solo los últimos N eventos
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
    
    // Log según severidad
    const logFn = event.severity === 'critical' ? console.error :
                  event.severity === 'warning' ? console.warn :
                  console.log;
    
    logFn(`[SECURITY ${event.severity.toUpperCase()}] ${event.eventType}:`, event.details);
  }
  
  /**
   * Obtiene eventos recientes
   */
  getRecentEvents(limit: number = 50): SecurityEvent[] {
    return this.events.slice(-limit);
  }
  
  /**
   * Busca eventos por tipo
   */
  getEventsByType(eventType: SecurityEvent['eventType']): SecurityEvent[] {
    return this.events.filter(e => e.eventType === eventType);
  }
  
  /**
   * Detecta actividad sospechosa
   */
  detectSuspiciousActivity(): {
    suspicious: boolean;
    reasons: string[];
  } {
    const reasons: string[] = [];
    
    // Múltiples fallos en poco tiempo
    const recentFailures = this.events.filter(
      e => e.eventType === 'unlock_failure' && 
           Date.now() - new Date(e.timestamp).getTime() < 5 * 60 * 1000 // 5 min
    );
    
    if (recentFailures.length >= 5) {
      reasons.push(`${recentFailures.length} failed unlock attempts in 5 minutes`);
    }
    
    // Múltiples rate limit hits
    const rateLimitHits = this.events.filter(
      e => e.eventType === 'rate_limit_hit' &&
           Date.now() - new Date(e.timestamp).getTime() < 10 * 60 * 1000 // 10 min
    );
    
    if (rateLimitHits.length >= 3) {
      reasons.push('Multiple rate limit violations');
    }
    
    // Uso de múltiples recovery codes
    const recoveryUses = this.events.filter(
      e => e.eventType === 'recovery_used' &&
           Date.now() - new Date(e.timestamp).getTime() < 24 * 60 * 60 * 1000 // 24h
    );
    
    if (recoveryUses.length >= 2) {
      reasons.push('Multiple recovery code uses in 24 hours');
    }
    
    return {
      suspicious: reasons.length > 0,
      reasons,
    };
  }
  
  /**
   * Exporta logs en formato JSON
   */
  exportLogs(): string {
    return JSON.stringify({
      exportDate: nowIso(),
      totalEvents: this.events.length,
      events: this.events,
    }, null, 2);
  }
  
  /**
   * Limpia eventos antiguos
   */
  clearOldEvents(olderThanDays: number = 30): number {
    const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    
    const initialCount = this.events.length;
    this.events = this.events.filter(
      e => new Date(e.timestamp).getTime() > cutoffTime
    );
    
    const removed = initialCount - this.events.length;
    console.log(`[SECURITY] Cleared ${removed} events older than ${olderThanDays} days`);
    
    return removed;
  }
}

/**
 * ANTI-FORENSICS: Secure Memory Wiping
 * 
 * Sobrescribe memoria sensible múltiples veces para dificultar recuperación
 */
export class SecureMemoryWiper {
  /**
   * Sobrescribe un buffer múltiples veces con diferentes patrones
   * 
   * Basado en DOD 5220.22-M standard (3 passes):
   * - Pass 1: Escribir 0x00
   * - Pass 2: Escribir 0xFF
   * - Pass 3: Random data
   */
  static async wipeBuffer(buffer: Uint8Array, passes: number = 3): Promise<void> {
    for (let pass = 0; pass < passes; pass++) {
      if (pass === 0) {
        // Pass 1: Zeros
        buffer.fill(0x00);
      } else if (pass === 1) {
        // Pass 2: Ones
        buffer.fill(0xFF);
      } else {
        // Pass 3+: Random
        crypto.getRandomValues(buffer);
      }
      
      // Force write (intento de prevenir optimizaciones del compilador)
      for (let i = 0; i < buffer.length; i += 64) {
        const _ = buffer[i]; // Force read
      }
    }
    
    // Final: Zeros
    buffer.fill(0x00);
  }
  
  /**
   * Sobrescribe múltiples buffers
   */
  static async wipeMultiple(...buffers: Uint8Array[]): Promise<void> {
    await Promise.all(buffers.map(b => this.wipeBuffer(b)));
  }
  
  /**
   * Crea un "canary" para detectar si un buffer fue modificado
   */
  static createCanary(size: number = 32): Uint8Array {
    const canary = new Uint8Array(size);
    crypto.getRandomValues(canary);
    return canary;
  }
  
  /**
   * Verifica si un canary fue modificado
   */
  static verifyCanary(canary: Uint8Array, expected: Uint8Array): boolean {
    if (canary.length !== expected.length) return false;
    
    let diff = 0;
    for (let i = 0; i < canary.length; i++) {
      diff |= canary[i] ^ expected[i];
    }
    
    return diff === 0;
  }
}

/**
 * TIMING OBFUSCATION
 * 
 * Añade ruido aleatorio a operaciones para dificultar timing attacks
 */
export class TimingObfuscator {
  /**
   * Ejecuta una función con timing aleatorio añadido
   */
  static async executeWithRandomDelay<T>(
    fn: () => Promise<T>,
    minDelayMs: number = 10,
    maxDelayMs: number = 100
  ): Promise<T> {
    const startTime = performance.now();
    
    // Ejecutar función
    const result = await fn();
    
    // Calcular tiempo transcurrido
    const elapsed = performance.now() - startTime;
    
    // Añadir delay aleatorio
    const randomDelay = minDelayMs + Math.random() * (maxDelayMs - minDelayMs);
    const totalDelay = Math.max(0, randomDelay - elapsed);
    
    if (totalDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, totalDelay));
    }
    
    return result;
  }
  
  /**
   * Normaliza el tiempo de ejecución a un mínimo fijo
   */
  static async normalizeExecutionTime<T>(
    fn: () => Promise<T>,
    targetTimeMs: number
  ): Promise<T> {
    const startTime = performance.now();
    const result = await fn();
    const elapsed = performance.now() - startTime;
    
    const remainingTime = targetTimeMs - elapsed;
    if (remainingTime > 0) {
      await new Promise(resolve => setTimeout(resolve, remainingTime));
    }
    
    return result;
  }
}

/**
 * DECOY DATA GENERATOR
 * 
 * Genera datos falsos para confundir análisis forense
 */
export class DecoyDataGenerator {
  /**
   * Genera un vault dummy con datos aleatorios
   */
  static generateDecoyVault(): {
    data: Uint8Array;
    metadata: Record<string, any>;
  } {
    // Generar tamaño similar a vault real (1-10 KB)
    const size = 1024 + Math.floor(Math.random() * 9 * 1024);
    const data = new Uint8Array(size);
    crypto.getRandomValues(data);
    
    // Metadata falsa
    const metadata = {
      version: 1,
      createdAt: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
      kdf: {
        kind: 'pbkdf2-sha256',
        iterations: 600000 + Math.floor(Math.random() * 100000),
      },
    };
    
    return { data, metadata };
  }
  
  /**
   * Genera múltiples decoys
   */
  static generateMultipleDecoys(count: number): Array<ReturnType<typeof DecoyDataGenerator.generateDecoyVault>> {
    const decoys = [];
    for (let i = 0; i < count; i++) {
      decoys.push(this.generateDecoyVault());
    }
    return decoys;
  }
}

/**
 * SINGLETON INSTANCES
 */
export const globalRateLimiter = new RateLimiter();
export const globalPasswordEnforcer = new PasswordStrengthEnforcer();
export const globalSecurityLogger = new SecurityAuditLogger();

/**
 * Helper: Ejecutar operación con todas las protecciones
 */
export async function executeSecureOperation<T>(
  identifier: string,
  operation: () => Promise<T>,
  options?: {
    logEventType?: SecurityEvent['eventType'];
    requireStrongPassword?: boolean;
    addTimingNoise?: boolean;
  }
): Promise<T> {
  const opts = {
    logEventType: 'unlock_success' as SecurityEvent['eventType'],
    requireStrongPassword: false,
    addTimingNoise: true,
    ...options,
  };
  
  // 1. Check rate limit
  const rateLimitCheck = await globalRateLimiter.checkAttempt(identifier);
  if (!rateLimitCheck.allowed) {
    globalSecurityLogger.log({
      eventType: 'rate_limit_hit',
      severity: 'warning',
      vaultId: identifier,
      details: {
        reason: rateLimitCheck.reason,
        waitTimeMs: rateLimitCheck.waitTimeMs,
      },
    });
    
    throw new Error(rateLimitCheck.reason || 'Rate limit exceeded');
  }
  
  try {
    // 2. Execute operation (con o sin timing obfuscation)
    const result = opts.addTimingNoise
      ? await TimingObfuscator.executeWithRandomDelay(operation, 50, 200)
      : await operation();
    
    // 3. Log success
    await globalRateLimiter.recordSuccessfulAttempt(identifier);
    globalSecurityLogger.log({
      eventType: opts.logEventType,
      severity: 'info',
      vaultId: identifier,
      details: { success: true },
    });
    
    return result;
    
  } catch (error) {
    // 4. Log failure
    await globalRateLimiter.recordFailedAttempt(identifier);
    globalSecurityLogger.log({
      eventType: 'unlock_failure',
      severity: 'warning',
      vaultId: identifier,
      details: {
        error: error.message,
        remainingAttempts: rateLimitCheck.remainingAttempts,
      },
    });
    
    throw error;
  }
}
