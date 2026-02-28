import {
  MESSAGE_TYPES,
  type AnyRequestMessage,
  type EntryAddPayload,
  type EntryDeletePayload,
  type EntryGetPayload,
  type EntryListPayload,
  type EntryUpdatePayload,
  type MessageType,
  type RequestMessage,
  type ResponseFor,
  type VaultCreatePayload,
  type VaultDeletePayload,
  type VaultUnlockPayload
} from "../../shared/messages";

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

  vaultDelete: (payload: VaultDeletePayload) =>
    sendTypedMessage({ type: MESSAGE_TYPES.VAULT_DELETE, payload }),

  vaultStatus: () => sendTypedMessage({ type: MESSAGE_TYPES.VAULT_STATUS }),

  entryList: (payload?: EntryListPayload) =>
    sendTypedMessage({ type: MESSAGE_TYPES.ENTRY_LIST, payload }),

  entryGet: (payload: EntryGetPayload) =>
    sendTypedMessage({ type: MESSAGE_TYPES.ENTRY_GET, payload }),

  entryAdd: (payload: EntryAddPayload) =>
    sendTypedMessage({ type: MESSAGE_TYPES.ENTRY_ADD, payload }),

  entryUpdate: (payload: EntryUpdatePayload) =>
    sendTypedMessage({ type: MESSAGE_TYPES.ENTRY_UPDATE, payload }),

  entryDelete: (payload: EntryDeletePayload) =>
    sendTypedMessage({ type: MESSAGE_TYPES.ENTRY_DELETE, payload })
};
