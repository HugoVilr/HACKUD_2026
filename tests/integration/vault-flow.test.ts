import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { MESSAGE_TYPES } from "../../src/shared/messages.ts";
import { handleMessage } from "../../src/background/session.ts";

type StorageRecord = Record<string, unknown>;

const createInMemoryChromeStorage = () => {
  const store: StorageRecord = {};

  return {
    _store: store,
    storage: {
      local: {
        async get(key: string) {
          return { [key]: store[key] };
        },
        async set(obj: StorageRecord) {
          for (const [k, v] of Object.entries(obj)) store[k] = v;
        },
        async remove(key: string) {
          delete store[key];
        }
      }
    }
  };
};

test("integration: vault create/unlock/entries/lock via background messages", async () => {
  if (!globalThis.crypto) {
    // Provide WebCrypto in Node.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).crypto = webcrypto as unknown as Crypto;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prevChrome = (globalThis as any).chrome;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chromeMock = createInMemoryChromeStorage() as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).chrome = chromeMock;

  try {
    const status1 = await handleMessage({ type: MESSAGE_TYPES.VAULT_STATUS });
    assert.equal(status1.ok, true);
    assert.equal(status1.data.hasVault, false);
    assert.equal(status1.data.locked, true);

    const master = "Abcdef1234!!";

    const created = await handleMessage({
      type: MESSAGE_TYPES.VAULT_CREATE,
      payload: { masterPassword: master, confirmPassword: master, vaultName: "Test Vault" }
    });
    assert.equal(created.ok, true);
    assert.equal(created.data.hasVault, true);
    assert.equal(created.data.locked, false);
    assert.equal(created.data.vaultName, "Test Vault");
    assert.equal(created.data.entryCount, 0);

    const listEmpty = await handleMessage({ type: MESSAGE_TYPES.ENTRY_LIST });
    assert.equal(listEmpty.ok, true);
    assert.deepEqual(listEmpty.data.entries, []);

    const add = await handleMessage({
      type: MESSAGE_TYPES.ENTRY_ADD,
      payload: {
        entry: {
          title: "Github",
          domain: "github.com",
          username: "demo",
          password: "p@ss",
          notes: "n"
        }
      }
    });
    assert.equal(add.ok, true);
    assert.ok(add.data.entry.id);
    assert.equal(add.data.entry.title, "Github");
    assert.ok(!("password" in add.data.entry));

    const entryId = add.data.entry.id;

    const list1 = await handleMessage({ type: MESSAGE_TYPES.ENTRY_LIST });
    assert.equal(list1.ok, true);
    assert.equal(list1.data.entries.length, 1);
    assert.equal(list1.data.entries[0]?.id, entryId);
    assert.ok(!("password" in list1.data.entries[0]!));

    const get1 = await handleMessage({
      type: MESSAGE_TYPES.ENTRY_GET,
      payload: { id: entryId }
    });
    assert.equal(get1.ok, true);
    assert.equal(get1.data.entry?.id, entryId);
    assert.ok(!("password" in (get1.data.entry ?? {})));

    const autofill = await handleMessage({
      type: MESSAGE_TYPES.AUTOFILL_QUERY_BY_DOMAIN,
      payload: { hostname: "github.com" }
    });
    assert.equal(autofill.ok, true);
    assert.equal(autofill.data.entries.length, 1);
    assert.equal(autofill.data.entries[0]?.id, entryId);
    assert.equal(autofill.data.entries[0]?.matchType, "exact");
    assert.ok(!("password" in (autofill.data.entries[0] ?? {})));

    const secret1 = await handleMessage({
      type: MESSAGE_TYPES.ENTRY_GET_SECRET,
      payload: { id: entryId }
    });
    assert.equal(secret1.ok, true);
    assert.equal(secret1.data.secret.id, entryId);
    assert.equal(secret1.data.secret.password, "p@ss");

    const update = await handleMessage({
      type: MESSAGE_TYPES.ENTRY_UPDATE,
      payload: {
        entry: {
          id: entryId,
          title: "Github (updated)",
          username: "demo2",
          password: "p@ss2",
          notes: "n2",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      }
    });
    assert.equal(update.ok, true);
    assert.equal(update.data.entry.id, entryId);
    assert.equal(update.data.entry.title, "Github (updated)");
    assert.ok(!("password" in update.data.entry));

    const secret2 = await handleMessage({
      type: MESSAGE_TYPES.ENTRY_GET_SECRET,
      payload: { id: entryId }
    });
    assert.equal(secret2.ok, true);
    assert.equal(secret2.data.secret.password, "p@ss2");

    const locked = await handleMessage({ type: MESSAGE_TYPES.VAULT_LOCK });
    assert.equal(locked.ok, true);
    assert.equal(locked.data.locked, true);

    const listLocked = await handleMessage({ type: MESSAGE_TYPES.ENTRY_LIST });
    assert.equal(listLocked.ok, false);
    assert.equal(listLocked.error.code, "LOCKED");
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).chrome = prevChrome;
  }
});
