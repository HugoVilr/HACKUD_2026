import { generatePassword } from "../core/generator/generator";
import { hibpCheck } from "../core/hibp/hibp";
import { MSG, type ApiResponse } from "../shared/messages";
import { hasEncryptedVault, loadEncryptedVault, saveEncryptedVault } from "../core/vault/storage";
import { createEncryptedVault, reencryptVault, unlockEncryptedVault } from "../core/vault/crypto";
import { deleteEntry, getEntrySecret, listPublicEntries, upsertEntry } from "../core/vault/entries";
import type { EncryptedVault, VaultPlaintext } from "../core/vault/types";


type Session = {
  unlocked: boolean;
  key: CryptoKey | null;
  plaintext: VaultPlaintext | null;
  encrypted: EncryptedVault | null;
  autoLockMs: number;
  timer: number | null;
};

const session: Session = {
  unlocked: false,
  key: null,
  plaintext: null,
  encrypted: null,
  autoLockMs: 5 * 60 * 1000,
  timer: null,
};

function ok<T>(data: T): ApiResponse<T> {
  return { ok: true, data };
}
function err(code: any, message: string): ApiResponse<any> {
  return { ok: false, error: { code, message } };
}

function touch() {
  if (session.timer) clearTimeout(session.timer);
  session.timer = setTimeout(() => lockNow(), session.autoLockMs) as unknown as number;
}

function lockNow() {
  session.unlocked = false;
  session.key = null;
  session.plaintext = null;
  session.encrypted = null;
  if (session.timer) clearTimeout(session.timer);
  session.timer = null;
}

function requireUnlocked() {
  if (!session.unlocked || !session.key || !session.plaintext || !session.encrypted) {
    throw new Error("LOCKED");
  }
}

export async function handleMessage(message: any): Promise<ApiResponse<any>> {
  try {
    touch();

    switch (message?.type) {
      case MSG.VAULT_STATUS: {
        const hv = await hasEncryptedVault();
        return ok({ hasVault: hv, locked: !session.unlocked });
      }

      case MSG.VAULT_CREATE: {
        const master = String(message.master ?? "");
        const vaultName = message.vaultName ? String(message.vaultName) : undefined;
        if (master.length < 8) return err("WEAK_MASTER", "Master password demasiado corta (min 8)");

        const { encrypted, key, plaintext } = await createEncryptedVault(master, vaultName);
        await saveEncryptedVault(encrypted);

        // dejamos sesión desbloqueada
        session.unlocked = true;
        session.key = key;
        session.plaintext = plaintext;
        session.encrypted = encrypted;

        return ok({ created: true });
      }

      case MSG.VAULT_UNLOCK: {
        const master = String(message.master ?? "");
        const enc = await loadEncryptedVault();
        if (!enc) return err("NO_VAULT", "No hay vault guardado");

        try {
          const { key, plaintext } = await unlockEncryptedVault(enc, master);
          session.unlocked = true;
          session.key = key;
          session.plaintext = plaintext;
          session.encrypted = enc;
          return ok({ unlocked: true });
        } catch {
          lockNow();
          return err("BAD_MASTER", "Master incorrecta o vault corrupto");
        }
      }

      case MSG.VAULT_LOCK: {
        lockNow();
        return ok({ locked: true });
      }

      case MSG.ENTRY_LIST: {
        requireUnlocked();
        return ok({ entries: listPublicEntries(session.plaintext!) });
      }

      case MSG.ENTRY_UPSERT: {
        requireUnlocked();
        const entry = message.entry ?? {};
        try {
          upsertEntry(session.plaintext!, entry);
        } catch (e: any) {
          if (String(e?.message).startsWith("VALIDATION:")) return err("VALIDATION", "Datos inválidos (title requerido)");
          return err("VALIDATION", "Datos inválidos");
        }

        const newEnc = await reencryptVault(session.key!, session.plaintext!, session.encrypted!);
        await saveEncryptedVault(newEnc);
        session.encrypted = newEnc;

        return ok({ saved: true });
      }

      case MSG.ENTRY_DELETE: {
        requireUnlocked();
        const id = String(message.id ?? "");
        deleteEntry(session.plaintext!, id);

        const newEnc = await reencryptVault(session.key!, session.plaintext!, session.encrypted!);
        await saveEncryptedVault(newEnc);
        session.encrypted = newEnc;

        return ok({ deleted: true });
      }

      case MSG.ENTRY_GET_SECRET: {
        requireUnlocked();
        const id = String(message.id ?? "");
        const sec = getEntrySecret(session.plaintext!, id);
        if (!sec) return err("NOT_FOUND", "Entry no encontrada");
        return ok({ secret: sec });
      }

      case MSG.GENERATE_PASSWORD: {
        const cfg = message.config ?? { length: 16 };
        const pwd = generatePassword(cfg);
        return ok({ password: pwd });
      }

      case MSG.HIBP_CHECK: {
        const password = String(message.password ?? "");
        if (!password) return err("VALIDATION", "Password vacío");
        try {
          const count = await hibpCheck(password);
          return ok({ count });
        } catch {
          return err("INTERNAL", "Error consultando HIBP");
        }
      }

      default:
        return err("UNKNOWN_MESSAGE", "Mensaje no soportado");
    }
  } catch (e: any) {
    if (String(e?.message) === "LOCKED") return err("LOCKED", "Vault bloqueada");
    return err("INTERNAL", "Error interno");
  }
}