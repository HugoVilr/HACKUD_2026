import type { EncryptedVault } from "./types";

const STORAGE_KEY = "vault_encrypted";

export const saveEncryptedVault = async (vault: EncryptedVault): Promise<void> => {
  await chrome.storage.local.set({ [STORAGE_KEY]: vault });
};

export const loadEncryptedVault = async (): Promise<EncryptedVault | null> => {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as EncryptedVault | undefined) ?? null;
};
