import type { VaultEntry, VaultPlaintext } from "./types";

export const addEntry = (vault: VaultPlaintext, entry: VaultEntry): VaultPlaintext => {
  return { ...vault, entries: [...vault.entries, entry] };
};

export const updateEntry = (vault: VaultPlaintext, entry: VaultEntry): VaultPlaintext => {
  return {
    ...vault,
    entries: vault.entries.map((item) => (item.id === entry.id ? entry : item))
  };
};

export const removeEntry = (vault: VaultPlaintext, id: string): VaultPlaintext => {
  return {
    ...vault,
    entries: vault.entries.filter((item) => item.id !== id)
  };
};
