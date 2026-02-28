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

  // Recovery codes (opcional para backwards compatibility)
  recoveryCodes?: {
    hashes: string[]; // SHA-256 hashes de los códigos (base64)
    used: boolean[];  // Marcadores de uso (cada código se usa solo una vez)
    // Master key cifrada con cada recovery code (permite recuperar acceso)
    encryptedKeys: Array<{
      salt_b64: string;
      iv_b64: string;
      ciphertext_b64: string;
    }>;
  };
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