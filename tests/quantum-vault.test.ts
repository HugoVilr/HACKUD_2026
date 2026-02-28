/**
 * QUANTUM CRYPTOGRAPHY TESTS
 * 
 * Suite de tests para el sistema de criptografía cuántica
 */

import { describe, it, expect } from '@jest/globals';
import {
  deriveQuantumResistantKey,
  quantumEncrypt,
  quantumDecrypt,
  QuantumKEM,
  constantTimeEqual,
  sanitizeMemory,
} from '../src/core/vault/quantum-crypto';

import {
  createQuantumVault,
  unlockQuantumVault,
  reencryptQuantumVault,
  verifyQuantumVaultIntegrity,
  getQuantumVaultSecurityInfo,
} from '../src/core/vault/quantum-vault';

const te = new TextEncoder();
const td = new TextDecoder();

describe('Quantum Key Derivation', () => {
  it('debería derivar claves correctamente', async () => {
    const password = 'TestPassword123!@#';
    const salt = crypto.getRandomValues(new Uint8Array(32));
    
    const keys = await deriveQuantumResistantKey(password, salt);
    
    expect(keys.encryptionKey).toBeDefined();
    expect(keys.authKey).toBeInstanceOf(Uint8Array);
    expect(keys.authKey.length).toBe(32); // 256 bits
    expect(keys.pepperKey.length).toBe(32);
    expect(keys.rawMaterial.length).toBe(32);
  });
  
  it('la misma password y salt deberían generar las mismas claves', async () => {
    const password = 'ConsistentPassword456';
    const salt = crypto.getRandomValues(new Uint8Array(32));
    
    const keys1 = await deriveQuantumResistantKey(password, salt);
    const keys2 = await deriveQuantumResistantKey(password, salt);
    
    // Comparar authKeys (único componente exportable fácilmente)
    const match = constantTimeEqual(keys1.authKey, keys2.authKey);
    expect(match).toBe(true);
  });
  
  it('diferentes passwords deberían generar claves diferentes', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(32));
    
    const keys1 = await deriveQuantumResistantKey('Password1', salt);
    const keys2 = await deriveQuantumResistantKey('Password2', salt);
    
    const match = constantTimeEqual(keys1.authKey, keys2.authKey);
    expect(match).toBe(false);
  });
  
  it('diferentes salts deberían generar claves diferentes', async () => {
    const password = 'SamePassword789';
    const salt1 = crypto.getRandomValues(new Uint8Array(32));
    const salt2 = crypto.getRandomValues(new Uint8Array(32));
    
    const keys1 = await deriveQuantumResistantKey(password, salt1);
    const keys2 = await deriveQuantumResistantKey(password, salt2);
    
    const match = constantTimeEqual(keys1.authKey, keys2.authKey);
    expect(match).toBe(false);
  });
});

describe('Quantum KEM (Key Encapsulation)', () => {
  it('debería generar par de claves', async () => {
    const keyPair = await QuantumKEM.generateKeyPair();
    
    expect(keyPair.publicKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.secretKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.publicKey.length).toBeGreaterThan(0);
    expect(keyPair.secretKey.length).toBeGreaterThan(0);
  });
  
  it('debería encapsular y desencapsular correctamente', async () => {
    const keyPair = await QuantumKEM.generateKeyPair();
    
    const { sharedSecret, ciphertext } = await QuantumKEM.encapsulate(keyPair.publicKey);
    const decapsulated = await QuantumKEM.decapsulate(ciphertext, keyPair.secretKey);
    
    expect(sharedSecret).toBeInstanceOf(Uint8Array);
    expect(decapsulated).toBeInstanceOf(Uint8Array);
    expect(sharedSecret.length).toBe(32); // 256 bits
  });
  
  it('diferentes public keys deberían generar diferentes ciphertexts', async () => {
    const kp1 = await QuantumKEM.generateKeyPair();
    const kp2 = await QuantumKEM.generateKeyPair();
    
    const enc1 = await QuantumKEM.encapsulate(kp1.publicKey);
    const enc2 = await QuantumKEM.encapsulate(kp2.publicKey);
    
    const match = constantTimeEqual(enc1.ciphertext, enc2.ciphertext);
    expect(match).toBe(false);
  });
});

describe('Triple-Layer Encryption', () => {
  it('debería encriptar y desencriptar correctamente', async () => {
    const password = 'SecurePassword123!';
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const keys = await deriveQuantumResistantKey(password, salt);
    
    const plaintext = te.encode('Sensitive data here');
    const metadata = { test: 'metadata' };
    
    const encrypted = await quantumEncrypt(keys, plaintext, metadata);
    const decrypted = await quantumDecrypt(keys, {
      layer1_iv: encrypted.layer1_iv,
      layer2_nonce: encrypted.layer2_nonce,
      layer3_iv: encrypted.layer3_iv,
      layer3_ct: encrypted.layer3_ct,
      hmac: encrypted.hmac,
    }, metadata);
    
    expect(td.decode(decrypted)).toBe('Sensitive data here');
  });
  
  it('debería fallar al desencriptar con clave incorrecta', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const keys1 = await deriveQuantumResistantKey('RightPassword', salt);
    const keys2 = await deriveQuantumResistantKey('WrongPassword', salt);
    
    const plaintext = te.encode('Secret message');
    const encrypted = await quantumEncrypt(keys1, plaintext);
    
    await expect(async () => {
      await quantumDecrypt(keys2, {
        layer1_iv: encrypted.layer1_iv,
        layer2_nonce: encrypted.layer2_nonce,
        layer3_iv: encrypted.layer3_iv,
        layer3_ct: encrypted.layer3_ct,
        hmac: encrypted.hmac,
      });
    }).rejects.toThrow();
  });
  
  it('debería fallar si el HMAC es modificado', async () => {
    const password = 'TestPassword';
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const keys = await deriveQuantumResistantKey(password, salt);
    
    const plaintext = te.encode('Data');
    const encrypted = await quantumEncrypt(keys, plaintext);
    
    // Corromper HMAC
    encrypted.hmac[0] ^= 0xFF;
    
    await expect(async () => {
      await quantumDecrypt(keys, {
        layer1_iv: encrypted.layer1_iv,
        layer2_nonce: encrypted.layer2_nonce,
        layer3_iv: encrypted.layer3_iv,
        layer3_ct: encrypted.layer3_ct,
        hmac: encrypted.hmac,
      });
    }).rejects.toThrow(/HMAC|integrity|tamper/i);
  });
  
  it('debería manejar datos grandes correctamente', async () => {
    const password = 'LargeDataTest123';
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const keys = await deriveQuantumResistantKey(password, salt);
    
    // Generar 1 MB de datos
    const largeData = new Uint8Array(1024 * 1024);
    crypto.getRandomValues(largeData);
    
    const encrypted = await quantumEncrypt(keys, largeData);
    const decrypted = await quantumDecrypt(keys, {
      layer1_iv: encrypted.layer1_iv,
      layer2_nonce: encrypted.layer2_nonce,
      layer3_iv: encrypted.layer3_iv,
      layer3_ct: encrypted.layer3_ct,
      hmac: encrypted.hmac,
    });
    
    expect(decrypted.length).toBe(largeData.length);
    expect(constantTimeEqual(decrypted, largeData)).toBe(true);
  }, 30000); // 30s timeout para datos grandes
});

describe('Quantum Vault Operations', () => {
  it('debería crear un quantum vault correctamente', async () => {
    const result = await createQuantumVault(
      'StrongPassword123!@#',
      'Test Vault',
      { description: 'Test vault', tags: ['test'] }
    );
    
    expect(result.encrypted.version).toBe(2);
    expect(result.encrypted.securityLevel).toBe('QUANTUM_MAX');
    expect(result.encrypted.kdf.kind).toBe('quantum-hybrid');
    expect(result.encrypted.cipher.kind).toBe('triple-cascade');
    expect(result.plaintext.entries).toEqual([]);
    expect(result.recoveryCodes).toHaveLength(4);
  }, 15000); // 15s timeout
  
  it('debería desbloquear un quantum vault', async () => {
    const password = 'UnlockTestPassword456';
    
    const created = await createQuantumVault(password, 'Unlock Test');
    const { plaintext } = await unlockQuantumVault(created.encrypted, password);
    
    expect(plaintext.entries).toEqual([]);
    expect(plaintext.profile?.vaultName).toBe('Unlock Test');
  }, 20000);
  
  it('debería fallar con password incorrecta', async () => {
    const created = await createQuantumVault('CorrectPassword', 'Fail Test');
    
    await expect(async () => {
      await unlockQuantumVault(created.encrypted, 'WrongPassword');
    }).rejects.toThrow(/password|decrypt|incorrect/i);
  }, 15000);
  
  it('debería re-encriptar un vault correctamente', async () => {
    const password = 'ReencryptTest789';
    
    const created = await createQuantumVault(password, 'Reencrypt Test');
    const { plaintext, keys } = await unlockQuantumVault(created.encrypted, password);
    
    // Modificar plaintext
    plaintext.entries.push({
      id: 'test-entry',
      name: 'Test Entry',
      username: 'user',
      password: 'pass',
      url: 'https://example.com',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    
    // Re-encriptar
    const reencrypted = await reencryptQuantumVault(keys, plaintext, created.encrypted);
    
    // Desbloquear nuevamente
    const { plaintext: unlocked } = await unlockQuantumVault(reencrypted, password);
    
    expect(unlocked.entries).toHaveLength(1);
    expect(unlocked.entries[0].name).toBe('Test Entry');
  }, 25000);
  
  it('debería verificar integridad correctamente', async () => {
    const password = 'IntegrityTest';
    
    const created = await createQuantumVault(password, 'Integrity Test');
    const { keys } = await unlockQuantumVault(created.encrypted, password);
    
    const isValid = await verifyQuantumVaultIntegrity(created.encrypted, keys);
    expect(isValid).toBe(true);
  }, 15000);
  
  it('debería detectar vault corrupto', async () => {
    const password = 'CorruptTest';
    
    const created = await createQuantumVault(password, 'Corrupt Test');
    const { keys } = await unlockQuantumVault(created.encrypted, password);
    
    // Corromper ciphertext
    const corrupted = { ...created.encrypted };
    const ctBytes = Buffer.from(corrupted.ciphertext_b64, 'base64');
    ctBytes[0] ^= 0xFF;
    corrupted.ciphertext_b64 = ctBytes.toString('base64');
    
    const isValid = await verifyQuantumVaultIntegrity(corrupted, keys);
    expect(isValid).toBe(false);
  }, 15000);
  
  it('debería rechazar contraseñas débiles para quantum vault', async () => {
    await expect(async () => {
      await createQuantumVault('weak', 'Weak Password Test');
    }).rejects.toThrow(/12 characters/i);
  });
  
  it('debería obtener información de seguridad', async () => {
    const created = await createQuantumVault('InfoTest123!@#', 'Info Test');
    const info = getQuantumVaultSecurityInfo(created.encrypted);
    
    expect(info.version).toBe(2);
    expect(info.securityLevel).toBe('QUANTUM_MAX');
    expect(info.postQuantumReady).toBe(true);
    expect(info.kdfAlgorithms).toContain('Argon2id');
    expect(info.encryptionLayers).toHaveLength(3);
    expect(info.recoveryCodesAvailable).toBe(4);
  }, 10000);
});

describe('Constant-Time Operations', () => {
  it('constantTimeEqual debería funcionar correctamente', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3, 4, 5]);
    const c = new Uint8Array([1, 2, 3, 4, 6]);
    
    expect(constantTimeEqual(a, b)).toBe(true);
    expect(constantTimeEqual(a, c)).toBe(false);
  });
  
  it('constantTimeEqual con diferentes longitudes debería retornar false', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3, 4]);
    
    expect(constantTimeEqual(a, b)).toBe(false);
  });
});

describe('Memory Sanitization', () => {
  it('sanitizeMemory debería sobrescribir buffers', () => {
    const buffer = new Uint8Array([1, 2, 3, 4, 5]);
    const original = new Uint8Array(buffer);
    
    sanitizeMemory(buffer);
    
    // Buffer debería estar modificado (no igual al original)
    expect(constantTimeEqual(buffer, original)).toBe(false);
    
    // Debería ser todo zeros después de sanitizar
    expect(buffer.every(b => b === 0)).toBe(true);
  });
});

describe('Performance Benchmarks', () => {
  it('debería medir tiempo de key derivation', async () => {
    const password = 'BenchmarkPassword123';
    const salt = crypto.getRandomValues(new Uint8Array(32));
    
    const start = performance.now();
    await deriveQuantumResistantKey(password, salt);
    const elapsed = performance.now() - start;
    
    console.log(`Key derivation time: ${elapsed.toFixed(2)}ms`);
    
    // Debería tomar al menos 1 segundo (por seguridad)
    expect(elapsed).toBeGreaterThan(1000);
    
    // Pero no más de 10 segundos (rendimiento razonable)
    expect(elapsed).toBeLessThan(10000);
  }, 15000);
  
  it('debería medir tiempo de vault creation', async () => {
    const start = performance.now();
    await createQuantumVault('PerfTest123!@#', 'Perf Test');
    const elapsed = performance.now() - start;
    
    console.log(`Vault creation time: ${elapsed.toFixed(2)}ms`);
    
    expect(elapsed).toBeGreaterThan(1000);
    expect(elapsed).toBeLessThan(15000);
  }, 20000);
  
  it('debería medir tiempo de unlock', async () => {
    const password = 'UnlockPerfTest456';
    const created = await createQuantumVault(password, 'Unlock Perf');
    
    const start = performance.now();
    await unlockQuantumVault(created.encrypted, password);
    const elapsed = performance.now() - start;
    
    console.log(`Vault unlock time: ${elapsed.toFixed(2)}ms`);
    
    expect(elapsed).toBeGreaterThan(1000);
    expect(elapsed).toBeLessThan(10000);
  }, 25000);
});

describe('Recovery Codes', () => {
  it('debería incluir 4 recovery codes', async () => {
    const result = await createQuantumVault('RecoveryTest123', 'Recovery Test');
    
    expect(result.recoveryCodes).toHaveLength(4);
    expect(result.encrypted.recoveryCodes?.hashes).toHaveLength(4);
    expect(result.encrypted.recoveryCodes?.used).toEqual([false, false, false, false]);
  }, 10000);
  
  it('todos los recovery codes deben ser únicos', async () => {
    const result = await createQuantumVault('UniqueTest456', 'Unique Test');
    
    const codes = result.recoveryCodes;
    const uniqueCodes = new Set(codes);
    
    expect(uniqueCodes.size).toBe(codes.length);
  }, 10000);
  
  it('recovery codes deben tener longitud adecuada', async () => {
    const result = await createQuantumVault('LengthTest789', 'Length Test');
    
    for (const code of result.recoveryCodes) {
      expect(code.length).toBeGreaterThanOrEqual(32); // 256 bits en base64
    }
  }, 10000);
});

describe('Edge Cases', () => {
  it('debería manejar vault name muy largo', async () => {
    const longName = 'A'.repeat(1000);
    const result = await createQuantumVault('EdgeCase1', longName);
    
    expect(result.plaintext.profile?.vaultName).toBe(longName);
  }, 10000);
  
  it('debería manejar metadata compleja', async () => {
    const complexMeta = {
      description: 'Test',
      tags: ['tag1', 'tag2', 'tag3'],
      nested: {
        deep: {
          value: 'nested data',
        },
      },
      array: [1, 2, 3, 4, 5],
    };
    
    const result = await createQuantumVault('EdgeCase2', 'Meta Test', complexMeta);
    
    expect(result.encrypted.metadata?.nested).toEqual(complexMeta.nested);
  }, 10000);
  
  it('debería manejar caracteres especiales en password', async () => {
    const specialPassword = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`';
    
    const created = await createQuantumVault(specialPassword, 'Special Chars');
    const { plaintext } = await unlockQuantumVault(created.encrypted, specialPassword);
    
    expect(plaintext).toBeDefined();
  }, 15000);
});
