/**
 * G8keeper Vault v2 – Maximum-security type definitions
 *
 * Vault format v2 upgrades:
 *   • KDF:    PBKDF2-SHA-512  (1 000 000 iterations, 256-bit salt)
 *   • HKDF:   SHA-512 key expansion → 3 purpose-bound CryptoKeys
 *   • Cipher: Double AES-256-GCM cascade with AAD metadata binding
 *   • MAC:    HMAC-SHA-512 over the full ciphertext envelope
 *
 * All primitives are natively supported by the Web Crypto API —
 * no polyfills, no WASM, no simulations.
 */

export type IsoDateTime = string;

/** Vault format version.  Only v2 is produced / accepted on this branch. */
export type VaultVersion = 2;

/** Key-derivation parameters stored alongside the vault. */
export type KdfParams = {
  kind: "pbkdf2-sha512";
  salt_b64: string;   // 256-bit salt, base-64
  iterations: number; // ≥ 1 000 000
};

/**
 * Three independent CryptoKeys derived via HKDF-SHA-512 from the PBKDF2
 * output.  Stored only in-memory while the vault is unlocked.
 *
 *   innerKey  → AES-256-GCM (plaintext layer, carries AAD)
 *   outerKey  → AES-256-GCM (envelope layer, defense-in-depth)
 *   hmacKey   → HMAC-SHA-512 (integrity tag over the ciphertext envelope)
 */
export type VaultKeyBundle = {
  innerKey: CryptoKey;
  outerKey: CryptoKey;
  hmacKey:  CryptoKey;
};

/** Encrypted vault persisted via `chrome.storage.local`. */
export interface EncryptedVault {
  version: VaultVersion;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;

  kdf: KdfParams;

  /** Double AES-256-GCM – two independent 96-bit IVs. */
  cipher: {
    kind: "aes-256-gcm-double";
    iv_inner_b64: string;
    iv_outer_b64: string;
  };

  ciphertext_b64: string;

  /** HMAC-SHA-512 over (iv_inner ‖ iv_outer ‖ ciphertext). */
  hmac_b64: string;

  /** Recovery codes – each one encrypts the raw 512-bit IKM. */
  recoveryCodes?: {
    hashes: string[];   // SHA-512 hashes of each code (base-64)
    used:   boolean[];  // one-time-use flags
    encryptedKeys: Array<{
      salt_b64:       string;
      iv_b64:         string;
      ciphertext_b64: string;
    }>;
  };
}

export interface VaultEntry {
  id: string;
  title: string;
  domain?: string;
  username?: string;
  password?: string; // ONLY in-memory (plaintext)
  notes?: string;
  tags?: string[];
  favorite?: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface VaultPlaintext {
  version: VaultVersion;
  profile?: { vaultName?: string };
  entries: VaultEntry[];
}