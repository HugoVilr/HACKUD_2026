export interface VaultEntry {
  id: string;
  title: string;
  username?: string;
  password?: string;
  notes?: string;
}

export interface VaultPlaintext {
  entries: VaultEntry[];
}

export interface EncryptedVault {
  ciphertextB64: string;
  ivB64: string;
  saltB64: string;
}
