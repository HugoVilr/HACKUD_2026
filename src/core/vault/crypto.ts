/**
 * G8keeper Vault v2 – Maximum-security cryptographic core
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                      REAL Web Crypto API                        │
 * ├─────────────────────────────────────────────────────────────────┤
 * │  KDF   │ PBKDF2-SHA-512, 1 000 000 iterations, 256-bit salt   │
 * │  HKDF  │ SHA-512 expand → innerKey + outerKey + hmacKey        │
 * │  ENC   │ Double AES-256-GCM cascade with AAD metadata binding  │
 * │  MAC   │ HMAC-SHA-512 (verify-first, constant-time)            │
 * │  IVs   │ 96-bit random per layer (NIST SP 800-38D)             │
 * │  RC    │ Raw IKM encrypted per recovery code (PBKDF2-SHA-512)  │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Key derivation flow:
 *
 *   masterPassword
 *         │
 *         ▼
 *   PBKDF2-SHA-512 (1M iter, 256-bit salt) → 512-bit raw IKM
 *         │
 *         ▼
 *   HKDF-SHA-512 expand (3 distinct info labels)
 *      ╭──────────┼──────────╮
 *   innerKey   outerKey   hmacKey
 *  (AES-256)  (AES-256)  (HMAC-512)
 *
 * Encryption flow:
 *
 *   plaintext
 *      │  AES-256-GCM (innerKey, iv₁, AAD = version‖kdf)
 *      ▼
 *   inner_ct
 *      │  AES-256-GCM (outerKey, iv₂)
 *      ▼
 *   outer_ct
 *      │  HMAC-SHA-512 (hmacKey, iv₁ ‖ iv₂ ‖ outer_ct)
 *      ▼
 *     hmac
 *
 * Decryption is verify-first: HMAC checked before any ciphertext
 * processing, using Web Crypto subtle.verify() for constant-time
 * comparison.
 */

import type {
  EncryptedVault,
  VaultKeyBundle,
  VaultPlaintext,
} from "./types.ts";
import { b64ToAb, b64ToU8, abToB64, u8ToB64 } from "../../shared/b64.ts";
import { nowIso } from "../../shared/time.ts";
import { isVaultPlaintext } from "./guards.ts";
import { generateRecoveryCodes } from "./recovery.ts";

/* ── Constants ─────────────────────────────────────────────────────── */

const te = new TextEncoder();
const td = new TextDecoder();

/** Cast helper – works around TS 5.7+ strict Uint8Array / BufferSource incompatibility. */
const buf = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

const VAULT_VERSION: 2 = 2;

/**
 * 1 000 000 iterations of PBKDF2-SHA-512.
 *
 * OWASP 2023 recommends ≥ 600 000 for PBKDF2-SHA-256.
 * SHA-512 doubles the internal block size and is considerably more
 * expensive on GPUs (128-byte blocks vs 64-byte), so 1M iterations
 * of SHA-512 provides substantially stronger brute-force resistance
 * than the industry-standard 600k / SHA-256.
 *
 * Expected latency: ~600-1200 ms on a modern laptop.
 */
const DEFAULT_ITERS = 1_000_000;

/* ── HKDF info labels (domain separation) ──────────────────────────── */

const HKDF_LABEL_INNER = te.encode("g8keeper-v2-inner-enc");
const HKDF_LABEL_OUTER = te.encode("g8keeper-v2-outer-enc");
const HKDF_LABEL_HMAC  = te.encode("g8keeper-v2-hmac-auth");

/* ═══════════════════════════════════════════════════════════════════ *
 *  Phase 1 – Key Derivation                                         *
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * Derive 512 bits of raw input keying material (IKM) from the master
 * password via PBKDF2-SHA-512.
 *
 * Returns the IKM **and** the fully-expanded VaultKeyBundle.
 * The caller MUST zero `rawIkm` as soon as it is no longer needed.
 */
async function deriveKeyBundle(
  master: string,
  salt: Uint8Array,
  iterations: number,
): Promise<{ keys: VaultKeyBundle; rawIkm: Uint8Array }> {
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    te.encode(master),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const rawBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: buf(salt), iterations, hash: "SHA-512" },
    passwordKey,
    512, // 64 bytes
  );

  const rawIkm = new Uint8Array(rawBits);
  const keys = await expandKeyBundle(rawIkm, salt);

  return { keys, rawIkm };
}

/**
 * HKDF-SHA-512 key expansion.  Produces three purpose-separated
 * CryptoKeys from 512 bits of input keying material.
 *
 * Each key uses a unique `info` label so that compromising one key
 * reveals nothing about the others (HKDF information-theoretic
 * independence guarantee, RFC 5869 §3).
 */
async function expandKeyBundle(
  rawIkm: Uint8Array,
  salt: Uint8Array,
): Promise<VaultKeyBundle> {
  const hkdfBase = await crypto.subtle.importKey(
    "raw",
    buf(rawIkm),
    "HKDF",
    false,
    ["deriveKey"],
  );

  const deriveAES = (info: Uint8Array) =>
    crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-512", salt: buf(salt), info: buf(info) },
      hkdfBase,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );

  const [innerKey, outerKey] = await Promise.all([
    deriveAES(HKDF_LABEL_INNER),
    deriveAES(HKDF_LABEL_OUTER),
  ]);

  const hmacKey = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-512", salt: buf(salt), info: buf(HKDF_LABEL_HMAC) },
    hkdfBase,
    { name: "HMAC", hash: "SHA-512" } as HmacKeyGenParams,
    false,
    ["sign", "verify"],
  );

  return { innerKey, outerKey, hmacKey };
}

/* ═══════════════════════════════════════════════════════════════════ *
 *  Phase 2 – Double AES-256-GCM + HMAC-SHA-512                      *
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * Canonical AAD blob.  Any external tampering with version or KDF
 * parameters will cause the inner AES-GCM authentication tag to
 * reject, preventing silent downgrade attacks.
 */
function buildAad(v: EncryptedVault): Uint8Array {
  return te.encode(
    JSON.stringify({
      version: v.version,
      kdf_kind: v.kdf.kind,
      iterations: v.kdf.iterations,
    }),
  );
}

function buildAadRaw(
  version: number,
  kdfKind: string,
  iterations: number,
): Uint8Array {
  return te.encode(
    JSON.stringify({ version, kdf_kind: kdfKind, iterations }),
  );
}

/**
 * Encrypt-then-MAC with double AES-256-GCM cascade.
 *
 *   plaintext →  AES-GCM(innerKey, iv₁, AAD)
 *            →  AES-GCM(outerKey, iv₂)
 *            →  HMAC-SHA-512(hmacKey, iv₁ ‖ iv₂ ‖ ciphertext)
 *
 * Both IVs are 96-bit random (NIST SP 800-38D §8.2.2).
 */
async function doubleEncryptJson(
  keys: VaultKeyBundle,
  obj: unknown,
  aad: Uint8Array,
): Promise<{
  iv_inner_b64: string;
  iv_outer_b64: string;
  ciphertext_b64: string;
  hmac_b64: string;
}> {
  const ivInner = crypto.getRandomValues(new Uint8Array(12));
  const ivOuter = crypto.getRandomValues(new Uint8Array(12));

  // Layer 1 – inner AES-256-GCM with AAD metadata binding
  const pt = te.encode(JSON.stringify(obj));
  const innerCt = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: buf(ivInner), additionalData: buf(aad) },
    keys.innerKey,
    pt,
  );

  // Layer 2 – outer AES-256-GCM envelope
  const outerCt = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: buf(ivOuter) },
    keys.outerKey,
    innerCt,
  );

  // HMAC-SHA-512 over the full envelope
  const outerU8 = new Uint8Array(outerCt);
  const hmacPayload = new Uint8Array(12 + 12 + outerU8.length);
  hmacPayload.set(ivInner, 0);
  hmacPayload.set(ivOuter, 12);
  hmacPayload.set(outerU8, 24);

  const hmac = await crypto.subtle.sign("HMAC", keys.hmacKey, hmacPayload);

  return {
    iv_inner_b64: u8ToB64(ivInner),
    iv_outer_b64: u8ToB64(ivOuter),
    ciphertext_b64: abToB64(outerCt),
    hmac_b64: abToB64(hmac),
  };
}

/**
 * Verify-first decryption.
 *
 * HMAC is checked BEFORE any ciphertext processing via Web Crypto
 * `subtle.verify()`, which performs constant-time comparison
 * internally.  This guarantees that no decryption oracle is exposed
 * if the integrity tag is invalid.
 */
async function doubleDecryptJson(
  keys: VaultKeyBundle,
  iv_inner_b64: string,
  iv_outer_b64: string,
  ciphertext_b64: string,
  hmac_b64: string,
  aad: Uint8Array,
): Promise<unknown> {
  const ivInner = b64ToU8(iv_inner_b64);
  const ivOuter = b64ToU8(iv_outer_b64);
  const outerCt = b64ToU8(ciphertext_b64);
  const hmac = b64ToAb(hmac_b64);

  // 1. HMAC-verify (constant-time via Web Crypto)
  const hmacPayload = new Uint8Array(12 + 12 + outerCt.length);
  hmacPayload.set(ivInner, 0);
  hmacPayload.set(ivOuter, 12);
  hmacPayload.set(outerCt, 24);

  const valid = await crypto.subtle.verify(
    "HMAC",
    keys.hmacKey,
    hmac,
    hmacPayload,
  );
  if (!valid) {
    throw new Error("HMAC integrity check failed – vault data may be tampered");
  }

  // 2. Strip outer AES-256-GCM envelope
  const innerCt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: buf(ivOuter) },
    keys.outerKey,
    buf(outerCt),
  );

  // 3. Decrypt inner layer with AAD verification
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: buf(ivInner), additionalData: buf(aad) },
    keys.innerKey,
    innerCt,
  );

  return JSON.parse(td.decode(pt));
}

/* ═══════════════════════════════════════════════════════════════════ *
 *  Phase 3 – Recovery-code key (encrypts raw IKM per code)          *
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * Derives an AES-256-GCM key from a recovery code using the same
 * PBKDF2-SHA-512 / 1M-iteration strength as the master password.
 */
async function deriveRecoveryCryptoKey(
  code: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    te.encode(code),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: buf(salt), iterations, hash: "SHA-512" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/* ═══════════════════════════════════════════════════════════════════ *
 *  Public API                                                       *
 * ═══════════════════════════════════════════════════════════════════ */

export function createEmptyPlaintext(vaultName?: string): VaultPlaintext {
  return {
    version: VAULT_VERSION,
    profile: vaultName ? { vaultName } : undefined,
    entries: [],
  };
}

/**
 * Create a brand-new encrypted vault.
 *
 * Returns:
 *   • `encrypted`      – persisted EncryptedVault (v2)
 *   • `keys`           – VaultKeyBundle (session-only, never persisted)
 *   • `plaintext`      – empty VaultPlaintext
 *   • `recoveryCodes`  – 4 one-time codes (show once, then discard)
 */
export async function createEncryptedVault(
  master: string,
  vaultName?: string,
) {
  const salt = crypto.getRandomValues(new Uint8Array(32)); // 256-bit salt
  const iterations = DEFAULT_ITERS;

  // Derive key bundle + exportable raw IKM (for recovery codes)
  const { keys, rawIkm } = await deriveKeyBundle(master, salt, iterations);

  const plaintext = createEmptyPlaintext(vaultName);

  const aad = buildAadRaw(VAULT_VERSION, "pbkdf2-sha512", iterations);
  const { iv_inner_b64, iv_outer_b64, ciphertext_b64, hmac_b64 } =
    await doubleEncryptJson(keys, plaintext, aad);

  // ── Recovery codes ─────────────────────────────────────────────
  const { codes, hashes } = await generateRecoveryCodes();
  const encryptedKeys: Array<{
    salt_b64: string;
    iv_b64: string;
    ciphertext_b64: string;
  }> = [];

  for (const code of codes) {
    const rcSalt = crypto.getRandomValues(new Uint8Array(32));
    const rcKey = await deriveRecoveryCryptoKey(code, rcSalt, iterations);
    const rcIv = crypto.getRandomValues(new Uint8Array(12));
    const rcCt = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: buf(rcIv) },
      rcKey,
      buf(rawIkm),
    );
    encryptedKeys.push({
      salt_b64: u8ToB64(rcSalt),
      iv_b64: u8ToB64(rcIv),
      ciphertext_b64: abToB64(rcCt),
    });
  }

  // Wipe raw key material
  rawIkm.fill(0);

  const t = nowIso();
  const encrypted: EncryptedVault = {
    version: VAULT_VERSION,
    createdAt: t,
    updatedAt: t,
    kdf: { kind: "pbkdf2-sha512", salt_b64: u8ToB64(salt), iterations },
    cipher: { kind: "aes-256-gcm-double", iv_inner_b64, iv_outer_b64 },
    ciphertext_b64,
    hmac_b64,
    recoveryCodes: {
      hashes,
      used: [false, false, false, false],
      encryptedKeys,
    },
  };

  return { encrypted, keys, plaintext, recoveryCodes: codes };
}

/**
 * Unlock an existing vault with the master password.
 */
export async function unlockEncryptedVault(
  encrypted: EncryptedVault,
  master: string,
) {
  if (encrypted.version !== VAULT_VERSION) throw new Error("Unsupported version");
  if (encrypted.kdf.kind !== "pbkdf2-sha512") throw new Error("Unsupported kdf");
  if (encrypted.cipher.kind !== "aes-256-gcm-double") throw new Error("Unsupported cipher");

  const salt = b64ToU8(encrypted.kdf.salt_b64);
  const { keys, rawIkm } = await deriveKeyBundle(master, salt, encrypted.kdf.iterations);
  rawIkm.fill(0); // not needed for regular unlock

  const aad = buildAad(encrypted);
  const plaintext = await doubleDecryptJson(
    keys,
    encrypted.cipher.iv_inner_b64,
    encrypted.cipher.iv_outer_b64,
    encrypted.ciphertext_b64,
    encrypted.hmac_b64,
    aad,
  );

  if (!isVaultPlaintext(plaintext)) throw new Error("Corrupt vault");

  return { keys, plaintext: plaintext as VaultPlaintext };
}

/**
 * Unlock using a one-time recovery code.
 *
 * Flow:
 *   1. Verify SHA-512 hash of the code (constant-time)
 *   2. Decrypt the 512-bit raw IKM stored under that code
 *   3. Expand IKM → VaultKeyBundle via HKDF-SHA-512
 *   4. Decrypt the vault
 */
export async function unlockWithRecoveryCode(
  encrypted: EncryptedVault,
  recoveryCode: string,
): Promise<{ keys: VaultKeyBundle; plaintext: VaultPlaintext; codeIndex: number }> {
  if (encrypted.version !== VAULT_VERSION) throw new Error("Unsupported version");
  if (!encrypted.recoveryCodes) throw new Error("No recovery codes available");

  const { verifyRecoveryCode } = await import("./recovery.ts");

  // Find matching hash (constant-time per comparison)
  let foundIndex = -1;
  for (let i = 0; i < encrypted.recoveryCodes.hashes.length; i++) {
    if (await verifyRecoveryCode(recoveryCode, encrypted.recoveryCodes.hashes[i])) {
      foundIndex = i;
      break;
    }
  }

  if (foundIndex === -1) throw new Error("Invalid recovery code");
  if (encrypted.recoveryCodes.used[foundIndex]) throw new Error("Recovery code already used");

  // Decrypt raw IKM
  const encKey = encrypted.recoveryCodes.encryptedKeys[foundIndex];
  const rcSalt = b64ToU8(encKey.salt_b64);
  const rcKey = await deriveRecoveryCryptoKey(
    recoveryCode,
    rcSalt,
    encrypted.kdf.iterations,
  );
  const rcIv = b64ToU8(encKey.iv_b64);
  const rcCt = b64ToAb(encKey.ciphertext_b64);

  let rawIkm: Uint8Array;
  try {
    rawIkm = new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf(rcIv) }, rcKey, rcCt),
    );
  } catch {
    throw new Error("Failed to decrypt key material with recovery code");
  }

  // Expand IKM → key bundle
  const salt = b64ToU8(encrypted.kdf.salt_b64);
  const keys = await expandKeyBundle(rawIkm, salt);
  rawIkm.fill(0);

  // Decrypt vault
  const aad = buildAad(encrypted);
  const plaintext = await doubleDecryptJson(
    keys,
    encrypted.cipher.iv_inner_b64,
    encrypted.cipher.iv_outer_b64,
    encrypted.ciphertext_b64,
    encrypted.hmac_b64,
    aad,
  );

  if (!isVaultPlaintext(plaintext)) throw new Error("Corrupt vault");

  return { keys, plaintext: plaintext as VaultPlaintext, codeIndex: foundIndex };
}

/**
 * Re-encrypt the vault with fresh IVs and a new HMAC after any
 * plaintext mutation (entry add / update / delete).
 *
 * Recovery codes are explicitly preserved (bug fix from v1 where
 * they were silently dropped on re-encrypt).
 */
export async function reencryptVault(
  keys: VaultKeyBundle,
  plaintext: VaultPlaintext,
  prev: EncryptedVault,
): Promise<EncryptedVault> {
  const aad = buildAad(prev);
  const { iv_inner_b64, iv_outer_b64, ciphertext_b64, hmac_b64 } =
    await doubleEncryptJson(keys, plaintext, aad);

  return {
    version: prev.version,
    createdAt: prev.createdAt,
    updatedAt: nowIso(),
    kdf: prev.kdf,
    cipher: { kind: "aes-256-gcm-double", iv_inner_b64, iv_outer_b64 },
    ciphertext_b64,
    hmac_b64,
    recoveryCodes: prev.recoveryCodes, // Preserved across re-encrypts
  };
}
