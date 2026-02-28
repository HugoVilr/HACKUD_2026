# 🔐 Quantum Security MAX - Example Usage

This file demonstrates how to use the quantum-resistant cryptography features.

## Basic Usage

### 1. Creating a Quantum Vault

```typescript
import { createQuantumVault } from './src/core/vault/quantum-vault';

async function createSecureVault() {
  try {
    // Create a quantum vault with maximum security
    const result = await createQuantumVault(
      'MySuperSecurePassword123!@#$',  // Master password (min 12 chars for quantum)
      'My Ultra-Secure Vault',          // Vault name
      {
        description: 'Contains crypto keys and sensitive documents',
        tags: ['personal', 'crypto', 'financial'],
      }
    );
    
    // Save the encrypted vault to storage
    localStorage.setItem('quantum_vault', JSON.stringify(result.encrypted));
    
    // ⚠️ CRITICAL: Display recovery codes to user ONCE
    console.log('\n⚠️ SAVE THESE RECOVERY CODES SAFELY ⚠️');
    console.log('You will need one of these if you forget your password:\n');
    result.recoveryCodes.forEach((code, i) => {
      console.log(`${i + 1}. ${code}`);
    });
    console.log('\nStore these codes in a safe place (NOT on your computer)');
    
    return result;
    
  } catch (error) {
    console.error('Failed to create quantum vault:', error.message);
    throw error;
  }
}
```

### 2. Unlocking a Quantum Vault

```typescript
import { unlockQuantumVault } from './src/core/vault/quantum-vault';
import { executeSecureOperation, globalSecurityLogger } from './src/core/vault/security-protections';

async function unlockVault(password: string) {
  try {
    // Load encrypted vault from storage
    const encryptedData = localStorage.getItem('quantum_vault');
    if (!encryptedData) {
      throw new Error('No vault found');
    }
    
    const encrypted = JSON.parse(encryptedData);
    
    // Unlock with security protections (rate limiting, audit logging, etc.)
    const result = await executeSecureOperation(
      encrypted.kdf.salt_b64, // Unique identifier
      async () => {
        return await unlockQuantumVault(encrypted, password);
      },
      {
        logEventType: 'unlock_success',
        addTimingNoise: true, // Protect against timing attacks
      }
    );
    
    console.log('✅ Vault unlocked successfully');
    console.log('Entries:', result.plaintext.entries);
    
    return result;
    
  } catch (error) {
    console.error('❌ Failed to unlock vault:', error.message);
    
    // Check if rate limited
    const stats = globalSecurityLogger.getRecentEvents(10);
    console.log('Recent security events:', stats);
    
    throw error;
  }
}
```

### 3. Adding Entries to Vault

```typescript
import { unlockQuantumVault, reencryptQuantumVault } from './src/core/vault/quantum-vault';

async function addEntry(password: string, newEntry: any) {
  // 1. Unlock vault
  const encrypted = JSON.parse(localStorage.getItem('quantum_vault')!);
  const { plaintext, keys } = await unlockQuantumVault(encrypted, password);
  
  // 2. Add new entry
  plaintext.entries.push({
    id: crypto.randomUUID(),
    name: newEntry.name,
    username: newEntry.username,
    password: newEntry.password,
    url: newEntry.url,
    notes: newEntry.notes,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  
  // 3. Re-encrypt vault with updated data
  const reencrypted = await reencryptQuantumVault(keys, plaintext, encrypted);
  
  // 4. Save
  localStorage.setItem('quantum_vault', JSON.stringify(reencrypted));
  
  console.log('✅ Entry added and vault re-encrypted');
}

// Example usage
await addEntry('MySuperSecurePassword123!@#$', {
  name: 'GitHub',
  username: 'myusername',
  password: 'gh_pat_...',
  url: 'https://github.com',
  notes: 'Personal account',
});
```

### 4. Verifying Vault Integrity

```typescript
import { 
  unlockQuantumVault, 
  verifyQuantumVaultIntegrity 
} from './src/core/vault/quantum-vault';

async function checkVaultIntegrity(password: string) {
  const encrypted = JSON.parse(localStorage.getItem('quantum_vault')!);
  
  // Unlock to get keys
  const { keys } = await unlockQuantumVault(encrypted, password);
  
  // Verify integrity
  const isValid = await verifyQuantumVaultIntegrity(encrypted, keys);
  
  if (isValid) {
    console.log('✅ Vault integrity verified - no tampering detected');
  } else {
    console.error('⚠️ VAULT INTEGRITY CHECK FAILED');
    console.error('⚠️ The vault may have been tampered with!');
    console.error('⚠️ DO NOT USE THIS VAULT');
  }
  
  return isValid;
}
```

### 5. Using Recovery Codes

```typescript
import { unlockQuantumVaultWithRecoveryCode } from './src/core/vault/quantum-vault';

async function recoverVault(recoveryCode: string) {
  try {
    const encrypted = JSON.parse(localStorage.getItem('quantum_vault')!);
    
    // Unlock with recovery code
    const { plaintext, codeIndex } = await unlockQuantumVaultWithRecoveryCode(
      encrypted,
      recoveryCode
    );
    
    console.log(`✅ Vault recovered using recovery code #${codeIndex + 1}`);
    console.log('⚠️ This recovery code is now USED and cannot be used again');
    console.log('⚠️ IMPORTANT: Change your master password immediately!');
    
    // Update vault to mark code as used
    encrypted.recoveryCodes.used[codeIndex] = true;
    localStorage.setItem('quantum_vault', JSON.stringify(encrypted));
    
    return plaintext;
    
  } catch (error) {
    console.error('❌ Recovery failed:', error.message);
    throw error;
  }
}
```

### 6. Getting Vault Security Information

```typescript
import { getQuantumVaultSecurityInfo } from './src/core/vault/quantum-vault';

function displaySecurityInfo() {
  const encrypted = JSON.parse(localStorage.getItem('quantum_vault')!);
  const info = getQuantumVaultSecurityInfo(encrypted);
  
  console.log('\n🔐 VAULT SECURITY INFORMATION\n');
  console.log(`Version: ${info.version}`);
  console.log(`Security Level: ${info.securityLevel}`);
  console.log(`Post-Quantum Ready: ${info.postQuantumReady ? '✅' : '❌'}`);
  console.log(`\nKDF Algorithms:`);
  info.kdfAlgorithms.forEach(alg => console.log(`  - ${alg}`));
  console.log(`\nEncryption Layers:`);
  info.encryptionLayers.forEach((layer, i) => console.log(`  ${i + 1}. ${layer}`));
  console.log(`\nMemory Hardness: ${info.memoryHardness}`);
  console.log(`Estimated Brute Force Time: ${info.estimatedBruteForceYears}`);
  console.log(`\nRecovery Codes:`);
  console.log(`  Available: ${info.recoveryCodesAvailable}`);
  console.log(`  Used: ${info.recoveryCodesUsed}`);
}
```

## Advanced Features

### Password Strength Validation

```typescript
import { globalPasswordEnforcer } from './src/core/vault/security-protections';

function validatePassword(password: string, isQuantumVault: boolean = true) {
  const result = globalPasswordEnforcer.validatePassword(password, isQuantumVault);
  
  console.log(`\n🔒 PASSWORD STRENGTH ANALYSIS\n`);
  console.log(`Valid: ${result.valid ? '✅' : '❌'}`);
  console.log(`Score: ${result.score}/100`);
  console.log(`Entropy: ${result.entropy} bits`);
  
  if (result.issues.length > 0) {
    console.log(`\n⚠️ Issues:`);
    result.issues.forEach(issue => console.log(`  - ${issue}`));
  }
  
  if (result.recommendations.length > 0) {
    console.log(`\n💡 Recommendations:`);
    result.recommendations.forEach(rec => console.log(`  - ${rec}`));
  }
  
  return result;
}

// Test passwords
validatePassword('weak', true);           // ❌ Too short, no complexity
validatePassword('Password123', true);    // ❌ Missing symbols, too short for quantum
validatePassword('MyVeryStr0ng!Pass@2026', true); // ✅ Good for quantum vault
```

### Generate Strong Password

```typescript
import { globalPasswordEnforcer } from './src/core/vault/security-protections';

function generatePassword() {
  // Generate a 24-character password with symbols
  const password = globalPasswordEnforcer.generateStrongPassword(24, true);
  
  console.log('Generated password:', password);
  
  // Validate it
  const validation = globalPasswordEnforcer.validatePassword(password, true);
  console.log(`Strength: ${validation.score}/100 (${validation.entropy} bits entropy)`);
  
  return password;
}
```

### Security Audit Logging

```typescript
import { globalSecurityLogger } from './src/core/vault/security-protections';

// Check recent security events
function checkSecurityEvents() {
  const events = globalSecurityLogger.getRecentEvents(20);
  
  console.log(`\n📋 RECENT SECURITY EVENTS (${events.length})\n`);
  
  events.forEach(event => {
    const time = new Date(event.timestamp).toLocaleString();
    const icon = event.severity === 'critical' ? '🚨' :
                 event.severity === 'warning' ? '⚠️' : 'ℹ️';
    
    console.log(`${icon} [${time}] ${event.eventType}`);
    console.log(`   ${JSON.stringify(event.details)}`);
  });
}

// Detect suspicious activity
function checkForThreats() {
  const analysis = globalSecurityLogger.detectSuspiciousActivity();
  
  if (analysis.suspicious) {
    console.log('\n🚨 SUSPICIOUS ACTIVITY DETECTED 🚨\n');
    analysis.reasons.forEach(reason => {
      console.log(`  ⚠️ ${reason}`);
    });
    console.log('\nRecommended actions:');
    console.log('  1. Change your master password immediately');
    console.log('  2. Review recent activity');
    console.log('  3. Check for unauthorized access');
  } else {
    console.log('✅ No suspicious activity detected');
  }
}

// Export audit logs
function exportLogs() {
  const logsJson = globalSecurityLogger.exportLogs();
  
  // Save to file or send to secure server
  const blob = new Blob([logsJson], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  // Trigger download
  const a = document.createElement('a');
  a.href = url;
  a.download = `security-audit-${Date.now()}.json`;
  a.click();
  
  console.log('✅ Security logs exported');
}
```

### Rate Limiting

```typescript
import { globalRateLimiter } from './src/core/vault/security-protections';

async function unlockWithRateLimit(vaultId: string, password: string) {
  // Check if attempt is allowed
  const check = await globalRateLimiter.checkAttempt(vaultId);
  
  if (!check.allowed) {
    const waitSeconds = Math.ceil(check.waitTimeMs! / 1000);
    throw new Error(
      `Too many failed attempts. Please wait ${waitSeconds} seconds.`
    );
  }
  
  console.log(`Attempts remaining: ${check.remainingAttempts}`);
  
  try {
    // Attempt unlock
    const result = await unlockQuantumVault(encrypted, password);
    
    // Success - reset rate limit
    await globalRateLimiter.recordSuccessfulAttempt(vaultId);
    
    return result;
    
  } catch (error) {
    // Failure - record failed attempt
    await globalRateLimiter.recordFailedAttempt(vaultId);
    
    throw error;
  }
}
```

## Performance Considerations

### Measuring Operations

```typescript
async function benchmarkOperations() {
  console.log('\n⏱️ PERFORMANCE BENCHMARKS\n');
  
  // 1. Key Derivation
  let start = performance.now();
  const salt = crypto.getRandomValues(new Uint8Array(32));
  await deriveQuantumResistantKey('TestPassword123!', salt);
  let elapsed = performance.now() - start;
  console.log(`Key Derivation: ${elapsed.toFixed(0)}ms`);
  
  // 2. Vault Creation
  start = performance.now();
  const created = await createQuantumVault('TestPass123!', 'Benchmark');
  elapsed = performance.now() - start;
  console.log(`Vault Creation: ${elapsed.toFixed(0)}ms`);
  
  // 3. Vault Unlock
  start = performance.now();
  await unlockQuantumVault(created.encrypted, 'TestPass123!');
  elapsed = performance.now() - start;
  console.log(`Vault Unlock: ${elapsed.toFixed(0)}ms`);
  
  // 4. Re-encryption
  const { plaintext, keys } = await unlockQuantumVault(created.encrypted, 'TestPass123!');
  start = performance.now();
  await reencryptQuantumVault(keys, plaintext, created.encrypted);
  elapsed = performance.now() - start;
  console.log(`Vault Re-encrypt: ${elapsed.toFixed(0)}ms`);
}
```

Expected times on modern hardware:
- Key Derivation: 2-5 seconds
- Vault Creation: 3-6 seconds
- Vault Unlock: 2-4 seconds
- Re-encryption: 1-3 seconds

## Security Best Practices

### 1. Master Password Guidelines

```typescript
// ✅ GOOD - Strong quantum vault password
const goodPasswords = [
  'MyQuantum!Secure@Vault#2026',        // 28 chars, mixed case, symbols
  'correct-horse-battery-staple-2026!', // Passphrase style
  'Tr0ub4dor&3-EnhancedVersion!',      // Mixed with numbers and symbols
];

// ❌ BAD - Weak passwords
const badPasswords = [
  'password123',        // Too short, common word
  'MyPassword',         // Too short, no numbers/symbols
  '12341234',           // Only numbers
  'qwertyuiop',         // Keyboard pattern
];
```

### 2. Recovery Code Storage

```typescript
// ✅ GOOD practices
const goodPractices = [
  'Write codes on paper and store in fireproof safe',
  'Use a password manager (separate from vault)',
  'Split codes across multiple secure locations',
  'Encrypt codes with a different password before storing',
];

// ❌ BAD practices
const badPractices = [
  'Store in same file as vault',
  'Email codes to yourself',
  'Store in plaintext on computer',
  'Share codes with anyone',
];
```

### 3. Security Checklist

```typescript
function performSecurityAudit() {
  console.log('\n🔒 SECURITY AUDIT CHECKLIST\n');
  
  // 1. Password strength
  const password = prompt('Enter your master password:');
  const strength = globalPasswordEnforcer.validatePassword(password!, true);
  console.log(`✓ Password strength: ${strength.score}/100`);
  
  // 2. Vault integrity
  const encrypted = JSON.parse(localStorage.getItem('quantum_vault')!);
  const { keys } = await unlockQuantumVault(encrypted, password!);
  const integrity = await verifyQuantumVaultIntegrity(encrypted, keys);
  console.log(`✓ Vault integrity: ${integrity ? 'Valid' : 'CORRUPTED'}`);
  
  // 3. Suspicious activity
  const threats = globalSecurityLogger.detectSuspiciousActivity();
  console.log(`✓ Suspicious activity: ${threats.suspicious ? 'DETECTED' : 'None'}`);
  
  // 4. Recovery codes
  const info = getQuantumVaultSecurityInfo(encrypted);
  console.log(`✓ Recovery codes available: ${info.recoveryCodesAvailable}/4`);
  
  // 5. Last updated
  const lastUpdate = new Date(encrypted.updatedAt);
  const daysSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24);
  console.log(`✓ Last updated: ${daysSinceUpdate.toFixed(0)} days ago`);
  
  console.log('\n✅ Security audit complete');
}
```

## Migration from Standard Vault

```typescript
import { unlockEncryptedVault } from './src/core/vault/crypto';
import { createQuantumVault, reencryptQuantumVault } from './src/core/vault/quantum-vault';
import { deriveQuantumResistantKey } from './src/core/vault/quantum-crypto';
import { b64ToU8 } from './src/shared/b64';

async function migrateToQuantumVault(password: string) {
  console.log('🔄 Starting migration to Quantum Vault...');
  
  // 1. Load and unlock standard vault
  const standardVault = JSON.parse(localStorage.getItem('vault')!);
  const { plaintext } = await unlockEncryptedVault(standardVault, password);
  console.log('✓ Standard vault unlocked');
  
  // 2. Create new quantum vault
  const quantumResult = await createQuantumVault(
    password,
    plaintext.profile?.vaultName || 'Migrated Vault',
    { description: 'Migrated from standard vault' }
  );
  console.log('✓ Quantum vault created');
  
  // 3. Copy all entries
  const newPlaintext = quantumResult.plaintext;
  newPlaintext.entries = plaintext.entries;
  
  // 4. Re-encrypt with new data
  const salt = b64ToU8(quantumResult.encrypted.kdf.salt_b64);
  const keys = await deriveQuantumResistantKey(password, salt);
  const final = await reencryptQuantumVault(keys, newPlaintext, quantumResult.encrypted);
  console.log('✓ Data migrated and re-encrypted');
  
  // 5. Save new vault
  localStorage.setItem('quantum_vault', JSON.stringify(final));
  console.log('✓ Quantum vault saved');
  
  // 6. Display recovery codes
  console.log('\n⚠️ NEW RECOVERY CODES - SAVE THESE NOW ⚠️\n');
  quantumResult.recoveryCodes.forEach((code, i) => {
    console.log(`${i + 1}. ${code}`);
  });
  
  // 7. Optionally backup and delete old vault
  localStorage.setItem('vault_backup', JSON.stringify(standardVault));
  localStorage.removeItem('vault');
  console.log('✓ Old vault backed up and removed');
  
  console.log('\n✅ Migration complete!');
  console.log('Your data is now protected with quantum-resistant cryptography.');
}
```

## Troubleshooting

### Common Issues

```typescript
// Issue: "Too many failed attempts"
// Solution: Wait for lockout period to expire
async function handleRateLimitLockout(vaultId: string) {
  const stats = globalRateLimiter.getStats(vaultId);
  
  if (stats?.isLocked) {
    const waitTime = stats.lockoutEndsAt!.getTime() - Date.now();
    const minutes = Math.ceil(waitTime / 60000);
    
    console.log(`⏳ Account locked. Please wait ${minutes} minutes.`);
    console.log(`Lockout ends at: ${stats.lockoutEndsAt!.toLocaleString()}`);
  }
}

// Issue: "HMAC verification failed"
// Solution: Vault may be corrupted or tampered
function handleIntegrityFailure() {
  console.error('🚨 VAULT INTEGRITY COMPROMISED');
  console.error('Possible causes:');
  console.error('  1. File corruption (disk error)');
  console.error('  2. Malicious tampering');
  console.error('  3. Software bug');
  console.error('\nRecommended actions:');
  console.error('  1. DO NOT use this vault');
  console.error('  2. Restore from backup if available');
  console.error('  3. Contact security team');
}

// Issue: Slow performance
// Solution: Check system resources
function diagnosePerformance() {
  console.log('💻 SYSTEM DIAGNOSTICS\n');
  console.log(`Available Memory: ${(performance as any).memory?.jsHeapSizeLimit / 1024 / 1024 || 'Unknown'} MB`);
  console.log(`Used Memory: ${(performance as any).memory?.usedJSHeapSize / 1024 / 1024 || 'Unknown'} MB`);
  console.log(`\nQuantum vault requires:`);
  console.log(`  - Minimum 512 MB available RAM`);
  console.log(`  - Modern CPU (2015+)`);
  console.log(`  - 2-5 seconds for operations`);
}
```

---

## Need Help?

- 📖 Read the full documentation: `/docs/QUANTUM_SECURITY.md`
- 🐛 Report issues on GitHub
- 💬 Join our Discord community
- 📧 Email: security@hackud2026.com

---

**Remember**: With great security comes great responsibility. Keep your master password and recovery codes safe!
