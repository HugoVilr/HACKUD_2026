export const deriveKey = async (_password: string, _salt: Uint8Array): Promise<CryptoKey> => {
  throw new Error("TODO: implement KDF in phase 3");
};

export const encryptVault = async (_plaintext: string): Promise<string> => {
  throw new Error("TODO: implement AES-GCM in phase 3");
};

export const decryptVault = async (_ciphertext: string): Promise<string> => {
  throw new Error("TODO: implement AES-GCM in phase 3");
};
