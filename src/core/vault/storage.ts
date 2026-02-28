import type { EncryptedVault } from "./types.ts";
import { isEncryptedVault } from "./guards.ts";

const KEY = "hackudc.vault.encrypted.v1";

export async function saveEncryptedVault(v: EncryptedVault): Promise<void> {
  await chrome.storage.local.set({ [KEY]: v });
}

export async function loadEncryptedVault(): Promise<EncryptedVault | null> {
  const obj = await chrome.storage.local.get(KEY);
  const raw = obj[KEY] as unknown;
  if (!raw) return null;
  if (!isEncryptedVault(raw)) return null;
  return raw;
}

export async function deleteEncryptedVault(): Promise<void> {
  await chrome.storage.local.remove(KEY);
}

export async function hasEncryptedVault(): Promise<boolean> {
  const obj = await chrome.storage.local.get(KEY);
  return obj[KEY] != null;
}
