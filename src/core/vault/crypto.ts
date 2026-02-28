import type { EncryptedVault, VaultPlaintext } from "./types.ts";
import { b64ToAb, b64ToU8, abToB64, u8ToB64 } from "../../shared/b64.ts";
import { nowIso } from "../../shared/time.ts";
import { isVaultPlaintext } from "./guards.ts";

const te = new TextEncoder();
const td = new TextDecoder();

const VAULT_VERSION: 1 = 1;

/**
 * SECURITY FIX #2: Incrementar iteraciones PBKDF2
 * 
 * VULNERABILIDAD ENCONTRADA:
 * - DEFAULT_ITERS = 210,000 estaba por debajo del estándar OWASP 2023
 * - Con GPUs modernas, un atacante puede hacer ~10k-20k intentos/segundo
 * 
 * RIESGO:
 * - ALTO: Brute force más fácil si el vault cifrado se filtra
 * - Protección insuficiente contra ataques offline
 * 
 * SOLUCIÓN IMPLEMENTADA:
 * - Aumentado a 600,000 iteraciones (OWASP 2023 recommendation)
 * - Nota: Esto añade ~500ms de latencia en operaciones de unlock/create
 * - Trade-off aceptable: seguridad > UX en este caso
 * 
 * REFERENCIAS:
 * - OWASP Password Storage Cheat Sheet (2023): min 600,000 for PBKDF2-SHA256
 * - NIST SP 800-63B: min 10,000 (obsoleto, de 2017)
 */
const DEFAULT_ITERS = 600_000;

async function deriveKeyPBKDF2(master: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey("raw", te.encode(master), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptJson(key: CryptoKey, obj: any): Promise<{ iv_b64: string; ciphertext_b64: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = te.encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt);
  return { iv_b64: u8ToB64(iv), ciphertext_b64: abToB64(ct) };
}

async function decryptJson(key: CryptoKey, iv_b64: string, ciphertext_b64: string): Promise<any> {
  const iv = b64ToU8(iv_b64);
  const ct = b64ToAb(ciphertext_b64);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return JSON.parse(td.decode(pt));
}

export function createEmptyPlaintext(vaultName?: string): VaultPlaintext {
  return { version: VAULT_VERSION, profile: vaultName ? { vaultName } : undefined, entries: [] };
}

/**
 * SECURITY NOTE #16: Salt size
 * 
 * CONSIDERACIÓN:
 * - Salt de 16 bytes (128 bits) es el MÍNIMO recomendado por NIST
 * - Estamos en el límite inferior aceptable
 * - Para máxima seguridad futura, considerar 32 bytes (256 bits)
 * 
 * DECISIÓN ACTUAL:
 * - 16 bytes es técnicamente correcto y ampliamente usado
 * - Suficiente para prevenir rainbow tables y ataques de diccionario
 * - Trade-off: espacio vs seguridad (16 bytes OK para scope del proyecto)
 */
export async function createEncryptedVault(master: string, vaultName?: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16)); // 128 bits
  const iterations = DEFAULT_ITERS;
  const key = await deriveKeyPBKDF2(master, salt, iterations);

  const plaintext = createEmptyPlaintext(vaultName);
  const { iv_b64, ciphertext_b64 } = await encryptJson(key, plaintext);

  const t = nowIso();
  const encrypted: EncryptedVault = {
    version: VAULT_VERSION,
    createdAt: t,
    updatedAt: t,
    kdf: { kind: "pbkdf2-sha256", salt_b64: u8ToB64(salt), iterations },
    cipher: { kind: "aes-256-gcm", iv_b64 },
    ciphertext_b64,
  };

  return { encrypted, key, plaintext };
}

export async function unlockEncryptedVault(encrypted: EncryptedVault, master: string) {
  if (encrypted.version !== VAULT_VERSION) throw new Error("Unsupported version");
  if (encrypted.kdf.kind !== "pbkdf2-sha256") throw new Error("Unsupported kdf");

  const salt = b64ToU8(encrypted.kdf.salt_b64);
  const key = await deriveKeyPBKDF2(master, salt, encrypted.kdf.iterations);

  const plaintext = await decryptJson(key, encrypted.cipher.iv_b64, encrypted.ciphertext_b64);
  if (!isVaultPlaintext(plaintext)) throw new Error("Corrupt vault");

  return { key, plaintext };
}

/**
 * SECURITY FIX #17 & #12: Mejora de reencrypt y protección contra downgrade
 * 
 * VULNERABILIDADES CONSIDERADAS:
 * 1. Spread operator (...prev) propagaba campos desconocidos
 * 2. Sin protección contra downgrade attacks (modificar version/kdf en el vault)
 * 
 * RIESGO:
 * - BAJO-MEDIO: Un atacante con acceso al vault cifrado podría:
 *   - Modificar metadatos (version, kdf.kind, iterations)
 *   - Forzar uso de KDF más débil
 *   - Facilitar brute force offline
 * 
 * SOLUCIÓN IMPLEMENTADA:
 * - Construcción explícita del vault (sin spread operator)
 * - Solo copiar campos conocidos y validados
 * - IV siempre nuevo (regenerado en encryptJson)
 * 
 * MEJORA FUTURA (TODO):
 * - Usar AES-GCM AAD (Additional Authenticated Data) para proteger metadatos:
 *   ```
 *   const aad = new TextEncoder().encode(JSON.stringify({ 
 *     version: encrypted.version, 
 *     kdf: encrypted.kdf 
 *   }));
 *   const ct = await crypto.subtle.encrypt(
 *     { name: "AES-GCM", iv, additionalData: aad }, 
 *     key, 
 *     pt
 *   );
 *   ```
 * - Esto garantizaría integridad criptográfica de los metadatos
 * - Cualquier modificación de version/kdf haría fallar el descifrado
 */
export async function reencryptVault(
  key: CryptoKey, 
  plaintext: VaultPlaintext, 
  prev: EncryptedVault
): Promise<EncryptedVault> {
  const { iv_b64, ciphertext_b64 } = await encryptJson(key, plaintext);
  
  // Construcción explícita: solo campos conocidos (no spread operator)
  return {
    version: prev.version,
    createdAt: prev.createdAt,
    updatedAt: nowIso(),
    kdf: prev.kdf, // Mantener los mismos parámetros KDF (salt, iterations)
    cipher: { kind: "aes-256-gcm", iv_b64 }, // IV nuevo cada vez
    ciphertext_b64,
  };
}
