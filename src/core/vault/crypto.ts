import type { EncryptedVault, VaultPlaintext } from "./types";
import { b64ToAb, b64ToU8, abToB64, u8ToB64 } from "../../shared/b64";
import { nowIso } from "../../shared/time";
import { isVaultPlaintext } from "./guards";

const te = new TextEncoder();
const td = new TextDecoder();

const VAULT_VERSION: 1 = 1;
const DEFAULT_ITERS = 210_000;

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

export async function createEncryptedVault(master: string, vaultName?: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
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

export async function reencryptVault(key: CryptoKey, plaintext: VaultPlaintext, prev: EncryptedVault): Promise<EncryptedVault> {
  const { iv_b64, ciphertext_b64 } = await encryptJson(key, plaintext);
  return {
    ...prev,
    updatedAt: nowIso(),
    cipher: { kind: "aes-256-gcm", iv_b64 },
    ciphertext_b64,
  };
}