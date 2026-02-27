import type { VaultEntry } from "../core/vault/types";
import {
  MESSAGE_TYPES,
  type AnyRequestMessage,
  type ApiResult,
  type MessageType,
  type MessageResponseMap,
  type VaultStatusData
} from "../shared/messages";

interface MockState {
  hasVault: boolean;
  locked: boolean;
  masterPassword: string;
  vaultName?: string;
  entries: VaultEntry[];
}

const mockState: MockState = {
  hasVault: false,
  locked: true,
  masterPassword: "",
  vaultName: undefined,
  entries: []
};

const ok = <TData>(data: TData): ApiResult<TData> => ({ ok: true, data });
const err = (code: string, message: string): ApiResult<never> => ({
  ok: false,
  error: { code, message }
});

const getStatus = (): VaultStatusData => ({
  hasVault: mockState.hasVault,
  locked: mockState.locked,
  vaultName: mockState.vaultName,
  entryCount: mockState.entries.length
});

const handleMessage = (message: AnyRequestMessage): MessageResponseMap[MessageType] => {
  switch (message.type) {
    case MESSAGE_TYPES.VAULT_CREATE: {
      const { masterPassword, confirmPassword, vaultName } = message.payload;
      if (!masterPassword || !confirmPassword) {
        return err("VALIDATION_ERROR", "Master password and confirm password are required.");
      }
      if (masterPassword !== confirmPassword) {
        return err("MASTER_MISMATCH", "Master passwords do not match.");
      }

      mockState.hasVault = true;
      mockState.locked = true;
      mockState.masterPassword = masterPassword;
      mockState.vaultName = vaultName?.trim() || "Vault";
      mockState.entries = [];
      return ok(getStatus());
    }

    case MESSAGE_TYPES.VAULT_UNLOCK: {
      if (!mockState.hasVault) {
        return err("VAULT_MISSING", "Vault does not exist.");
      }
      if (message.payload.masterPassword !== mockState.masterPassword) {
        return err("MASTER_INCORRECT", "Master password is incorrect.");
      }
      mockState.locked = false;
      return ok(getStatus());
    }

    case MESSAGE_TYPES.VAULT_LOCK: {
      mockState.locked = true;
      return ok(getStatus());
    }

    case MESSAGE_TYPES.VAULT_STATUS: {
      return ok(getStatus());
    }

    case MESSAGE_TYPES.ENTRY_LIST: {
      if (mockState.locked) {
        return err("VAULT_LOCKED", "Vault is locked.");
      }
      const query = message.payload?.query?.trim().toLowerCase();
      const entries = !query
        ? mockState.entries
        : mockState.entries.filter((entry) => {
            return (
              entry.title.toLowerCase().includes(query) ||
              (entry.username ?? "").toLowerCase().includes(query) ||
              (entry.notes ?? "").toLowerCase().includes(query)
            );
          });
      return ok({ entries });
    }

    case MESSAGE_TYPES.ENTRY_GET: {
      if (mockState.locked) {
        return err("VAULT_LOCKED", "Vault is locked.");
      }
      const entry = mockState.entries.find((item) => item.id === message.payload.id) ?? null;
      return ok({ entry });
    }

    case MESSAGE_TYPES.ENTRY_ADD: {
      if (mockState.locked) {
        return err("VAULT_LOCKED", "Vault is locked.");
      }
      const id = `entry-${Date.now()}`;
      const created: VaultEntry = { id, ...message.payload.entry };
      mockState.entries = [created, ...mockState.entries];
      return ok({ entry: created });
    }

    case MESSAGE_TYPES.ENTRY_UPDATE: {
      if (mockState.locked) {
        return err("VAULT_LOCKED", "Vault is locked.");
      }
      const entry = message.payload.entry;
      const exists = mockState.entries.some((item) => item.id === entry.id);
      if (!exists) {
        return err("ENTRY_NOT_FOUND", "Entry not found.");
      }
      mockState.entries = mockState.entries.map((item) => (item.id === entry.id ? entry : item));
      return ok({ entry });
    }

    case MESSAGE_TYPES.ENTRY_DELETE: {
      if (mockState.locked) {
        return err("VAULT_LOCKED", "Vault is locked.");
      }
      const exists = mockState.entries.some((item) => item.id === message.payload.id);
      if (!exists) {
        return err("ENTRY_NOT_FOUND", "Entry not found.");
      }
      mockState.entries = mockState.entries.filter((item) => item.id !== message.payload.id);
      return ok({ id: message.payload.id });
    }

    default: {
      return err("UNKNOWN_MESSAGE", "Message type is not supported.");
    }
  }
};

chrome.runtime.onMessage.addListener((message: AnyRequestMessage, _sender, sendResponse) => {
  const result = handleMessage(message);
  sendResponse(result as MessageResponseMap[AnyRequestMessage["type"]]);
  return true;
});
