/**
 * G8keeper Recovery Codes – v2 (SHA-512 hashing)
 *
 * 4 one-time codes, 256-bit entropy each, derived via HKDF-SHA-512.
 * Stored as SHA-512 hashes.
 */

import { u8ToB64, b64ToU8 } from "../../shared/b64.ts";

const te = new TextEncoder();
const td = new TextDecoder();

// Base58 alphabet (sin 0, O, I, l para evitar confusión)
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Convierte bytes a Base58 (más amigable que Base64, sin caracteres ambiguos)
 */
function toBase58(bytes: Uint8Array): string {
  let num = 0n;
  for (const byte of bytes) {
    num = num * 256n + BigInt(byte);
  }

  if (num === 0n) return BASE58_ALPHABET[0];

  let result = "";
  while (num > 0n) {
    const remainder = Number(num % 58n);
    result = BASE58_ALPHABET[remainder] + result;
    num = num / 58n;
  }

  // Preservar leading zeros
  for (const byte of bytes) {
    if (byte !== 0) break;
    result = BASE58_ALPHABET[0] + result;
  }

  return result;
}

/**
 * Convierte Base58 a bytes
 */
function fromBase58(str: string): Uint8Array {
  let num = 0n;
  for (const char of str) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Invalid Base58 character");
    num = num * 58n + BigInt(index);
  }

  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num % 256n));
    num = num / 256n;
  }

  // Preservar leading zeros
  for (const char of str) {
    if (char !== BASE58_ALPHABET[0]) break;
    bytes.unshift(0);
  }

  return new Uint8Array(bytes);
}

/**
 * HKDF-SHA512: Deriva múltiples claves de un secret maestro
 * 
 * Implementación simplificada (extract + expand) usando HMAC-SHA512
 */
async function hkdfSha512(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number
): Promise<Uint8Array> {
  // HKDF-Extract: PRK = HMAC-Hash(salt, IKM)
  const prk = await hmacSha512(salt, ikm);

  // HKDF-Expand: T(0) = empty, T(i) = HMAC-Hash(PRK, T(i-1) | info | [i])
  const hashLen = 64; // SHA512 = 64 bytes
  const n = Math.ceil(length / hashLen);
  const okm = new Uint8Array(n * hashLen);

  let prev = new Uint8Array(0);
  for (let i = 0; i < n; i++) {
    const input = new Uint8Array(prev.length + info.length + 1);
    input.set(prev);
    input.set(info, prev.length);
    input[input.length - 1] = i + 1;

    const result = await hmacSha512(prk, input);
    // Crear nueva Uint8Array para evitar problemas de tipos
    prev = new Uint8Array(result);
    okm.set(prev, i * hashLen);
  }

  return okm.slice(0, length);
}

/**
 * HMAC-SHA512 usando Web Crypto API
 */
async function hmacSha512(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, data as unknown as BufferSource);
  return new Uint8Array(sig);
}

/**
 * SHA-512 hash (upgraded from SHA-256 for v2 maximum security)
 */
async function sha512(data: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest("SHA-512", data as unknown as BufferSource);
  return new Uint8Array(hash);
}

/**
 * Generar 4 recovery codes ultra seguros
 * 
 * RETORNA:
 * - codes: Array de 4 códigos en texto plano (para mostrar al usuario)
 * - hashes: Array de 4 hashes SHA-256 en base64 (para almacenar)
 * - masterSecret: Secret maestro en base64 (NO almacenar, solo para derivación)
 */
export async function generateRecoveryCodes(): Promise<{
  codes: string[];
  hashes: string[];
  masterSecret: string;
}> {
  try {
    // Generar master secret de 32 bytes (256 bits)
    const masterSecret = crypto.getRandomValues(new Uint8Array(32));

    // Generar salt común para HKDF
    const salt = crypto.getRandomValues(new Uint8Array(32));

    const codes: string[] = [];
    const hashes: string[] = [];

    // Derivar 4 códigos únicos usando HKDF con diferentes info
    for (let i = 0; i < 4; i++) {
      const info = te.encode(`recovery-code-v2-${i}`);
      const codeBytes = await hkdfSha512(masterSecret, salt, info, 32);

      // Base58 encoding (human-friendly, no ambiguous chars)
      const codeStr = toBase58(codeBytes);
      codes.push(codeStr);

      // SHA-512 hash for storage (never store plaintext codes)
      const hash = await sha512(codeBytes);
      hashes.push(u8ToB64(hash));
    }

    return {
      codes,
      hashes,
      masterSecret: u8ToB64(masterSecret),
    };
  } catch (error) {
    throw error;
  }
}

/**
 * Verificar si un código de recuperación es válido
 * 
 * @param code Código ingresado por el usuario (Base58)
 * @param expectedHash Hash SHA-256 esperado (base64)
 * @returns true si el código es válido
 */
export async function verifyRecoveryCode(
  code: string,
  expectedHash: string
): Promise<boolean> {
  try {
    const codeBytes = fromBase58(code);
    const hash = await sha512(codeBytes);
    const hashB64 = u8ToB64(hash);
    
    // Comparación constant-time para prevenir timing attacks
    return constantTimeEqual(hashB64, expectedHash);
  } catch {
    return false;
  }
}

/**
 * Comparación constant-time de strings
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  
  return diff === 0;
}

/**
 * Exportar recovery codes a formato de texto para guardar
 */
export function exportRecoveryCodesAsText(codes: string[], vaultName?: string): string {
  const date = new Date().toLocaleString();
  const vault = vaultName ? ` - ${vaultName}` : "";
  
  let text = `═══════════════════════════════════════════════════════════════
  PASSWORD MANAGER - RECOVERY CODES${vault}
═══════════════════════════════════════════════════════════════

IMPORTANTE: Guarda estos códigos en un lugar seguro.
Cada código puede usarse UNA SOLA VEZ para recuperar acceso
a tu vault si olvidas tu contraseña maestra.

⚠️  NO COMPARTAS estos códigos con nadie
⚠️  NO los guardes en formato digital sin cifrar
⚠️  IMPRÍMELOS y guárdalos en un lugar físico seguro

Generados: ${date}

───────────────────────────────────────────────────────────────
CÓDIGOS DE RECUPERACIÓN:
───────────────────────────────────────────────────────────────

`;

  codes.forEach((code, i) => {
    text += `${i + 1}. ${code}\n\n`;
  });

  text += `───────────────────────────────────────────────────────────────

Cada código tiene 256 bits de entropía y es criptográficamente
seguro contra ataques de fuerza bruta.

═══════════════════════════════════════════════════════════════\n`;

  return text;
}
