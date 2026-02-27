export type IsoDateTime = string;
export type VaultVersion = 1;

export type KdfParams =
  | {
      kind: "pbkdf2-sha256";
      salt_b64: string;
      iterations: number;
    };

export interface EncryptedVault {
  version: VaultVersion;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;

  kdf: KdfParams;

  cipher: {
    kind: "aes-256-gcm";
    iv_b64: string;
  };

  ciphertext_b64: string;
}

export interface VaultEntry {
  id: string;
  title: string;
  domain?: string;
  username?: string;
  password?: string; // SOLO en memoria (plaintext)
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