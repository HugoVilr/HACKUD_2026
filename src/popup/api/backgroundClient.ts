import {
  MESSAGE_TYPES,
  type AnyRequestMessage,
  type EntryAddPayload,
  type EntryDeletePayload,
  type EntryGetPayload,
  type EntryGetSecretPayload,
  type EntryListPayload,
  type EntryUpdatePayload,
  type GeneratePasswordPayload,
  type HibpCheckPayload,
  type MessageType,
  type RequestMessage,
  type ResponseFor,
  type VaultCreatePayload,
  type VaultUnlockPayload
} from "../../shared/messages.ts";

const sendTypedMessage = <TType extends MessageType>(
  message: RequestMessage<TType>
): Promise<ResponseFor<TType>> => {
  return chrome.runtime.sendMessage(message) as Promise<ResponseFor<TType>>;
};

export const backgroundClient = {
  sendRaw: (message: AnyRequestMessage): Promise<unknown> => chrome.runtime.sendMessage(message),

  vaultCreate: (payload: VaultCreatePayload) =>
    sendTypedMessage({ type: MESSAGE_TYPES.VAULT_CREATE, payload }),

  vaultUnlock: (payload: VaultUnlockPayload) =>
    sendTypedMessage({ type: MESSAGE_TYPES.VAULT_UNLOCK, payload }),

  vaultLock: () => sendTypedMessage({ type: MESSAGE_TYPES.VAULT_LOCK }),

  vaultStatus: () => sendTypedMessage({ type: MESSAGE_TYPES.VAULT_STATUS }),

  entryList: (payload?: EntryListPayload) =>
    sendTypedMessage({ type: MESSAGE_TYPES.ENTRY_LIST, payload }),

  entryGet: (payload: EntryGetPayload) =>
    sendTypedMessage({ type: MESSAGE_TYPES.ENTRY_GET, payload }),

  entryGetSecret: (payload: EntryGetSecretPayload) =>
    sendTypedMessage({ type: MESSAGE_TYPES.ENTRY_GET_SECRET, payload }),

  entryAdd: (payload: EntryAddPayload) =>
    sendTypedMessage({ type: MESSAGE_TYPES.ENTRY_ADD, payload }),

  entryUpdate: (payload: EntryUpdatePayload) =>
    sendTypedMessage({ type: MESSAGE_TYPES.ENTRY_UPDATE, payload }),

  entryDelete: (payload: EntryDeletePayload) =>
    sendTypedMessage({ type: MESSAGE_TYPES.ENTRY_DELETE, payload }),

  generatePassword: (payload: GeneratePasswordPayload) =>
    sendTypedMessage({ type: MESSAGE_TYPES.GENERATE_PASSWORD, payload }),

  // HIBP check is executed in background to keep network access/permissions centralized.
  hibpCheck: (payload: HibpCheckPayload) =>
    sendTypedMessage({ type: MESSAGE_TYPES.HIBP_CHECK, payload })
};
