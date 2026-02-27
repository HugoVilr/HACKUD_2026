import type { EncryptedVault, VaultPlaintext, VaultEntry } from "./types";

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;
const isStr = (x: unknown): x is string => typeof x === "string";

export function isEncryptedVault(x: unknown): x is EncryptedVault {
  if (!isObj(x)) return false;
  if (x.version !== 1) return false;
  if (!isStr(x.createdAt) || !isStr(x.updatedAt)) return false;
  if (!isObj(x.kdf) || !isObj(x.cipher)) return false;

  const kdf = x.kdf as Record<string, unknown>;
  const cipher = x.cipher as Record<string, unknown>;

  if (kdf.kind !== "pbkdf2-sha256") return false;
  if (!isStr(kdf.salt_b64) || typeof kdf.iterations !== "number") return false;

  if (cipher.kind !== "aes-256-gcm") return false;
  if (!isStr(cipher.iv_b64)) return false;

  if (!isStr((x as any).ciphertext_b64)) return false;
  return true;
}

export function isVaultEntry(x: unknown): x is VaultEntry {
  if (!isObj(x)) return false;
  if (!isStr(x.id) || !isStr(x.title)) return false;
  if (!isStr(x.createdAt) || !isStr(x.updatedAt)) return false;
  if (x.domain !== undefined && !isStr(x.domain)) return false;
  if (x.username !== undefined && !isStr(x.username)) return false;
  if (x.password !== undefined && !isStr(x.password)) return false;
  if (x.notes !== undefined && !isStr(x.notes)) return false;
  if (x.tags !== undefined && (!Array.isArray(x.tags) || !x.tags.every(isStr))) return false;
  if (x.favorite !== undefined && typeof x.favorite !== "boolean") return false;
  return true;
}

export function isVaultPlaintext(x: unknown): x is VaultPlaintext {
  if (!isObj(x)) return false;
  if (x.version !== 1) return false;
  if (!Array.isArray((x as any).entries)) return false;
  if (!(x as any).entries.every(isVaultEntry)) return false;
  return true;
}