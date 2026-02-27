import type { VaultPlaintext } from "./types";

export const isVaultPlaintext = (value: unknown): value is VaultPlaintext => {
  return typeof value === "object" && value !== null && Array.isArray((value as VaultPlaintext).entries);
};
