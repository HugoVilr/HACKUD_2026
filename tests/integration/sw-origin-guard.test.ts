import test from "node:test";
import assert from "node:assert/strict";
import { MESSAGE_TYPES } from "../../src/shared/messages.ts";

let registeredListener:
  | ((
      message: unknown,
      sender: { id?: string; tab?: unknown },
      sendResponse: (response: unknown) => void
    ) => boolean)
  | null = null;

const storage: Record<string, unknown> = {};
let openPopupCalls = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prevChrome = (globalThis as any).chrome;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).chrome = {
  runtime: {
    id: "test-extension-id",
    onMessage: {
      addListener(fn: typeof registeredListener) {
        registeredListener = fn;
      },
    },
  },
  action: {
    async openPopup() {
      openPopupCalls += 1;
    },
  },
  storage: {
    local: {
      async get(key: string) {
        return { [key]: storage[key] };
      },
      async set(obj: Record<string, unknown>) {
        for (const [k, v] of Object.entries(obj)) storage[k] = v;
      },
      async remove(key: string) {
        delete storage[key];
      },
    },
  },
};

await import("../../src/background/sw.ts");

if (!registeredListener) {
  throw new Error("background listener was not registered");
}

async function dispatch(
  message: unknown,
  sender: { id?: string; tab?: unknown }
): Promise<any> {
  return new Promise((resolve) => {
    const keepAlive = registeredListener!(message, sender, resolve);
    assert.equal(keepAlive, true);
  });
}

test("sw: blocks messages from invalid sender id", async () => {
  const res = await dispatch({ type: MESSAGE_TYPES.VAULT_STATUS }, { id: "other-extension" });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "FORBIDDEN");
  assert.equal(res.error.message, "Invalid message origin");
});

test("sw: blocks non-allowlisted content-script message", async () => {
  const res = await dispatch(
    {
      type: MESSAGE_TYPES.ENTRY_ADD,
      payload: { entry: { title: "x", password: "y" } },
    },
    { id: "test-extension-id", tab: { id: 1 } }
  );

  assert.equal(res.ok, false);
  assert.equal(res.error.code, "FORBIDDEN");
  assert.equal(res.error.message, "Content scripts are not allowed to communicate with vault");
});

test("sw: allows content-script UI_OPEN_POPUP and calls chrome.action.openPopup", async () => {
  const before = openPopupCalls;

  const res = await dispatch(
    { type: MESSAGE_TYPES.UI_OPEN_POPUP },
    { id: "test-extension-id", tab: { id: 1 } }
  );

  assert.equal(res.ok, true);
  assert.equal(res.data.opened, true);
  assert.equal(openPopupCalls, before + 1);
});

test("sw: allows content-script ENTRY_GET_SECRET through router (not FORBIDDEN)", async () => {
  const res = await dispatch(
    { type: MESSAGE_TYPES.ENTRY_GET_SECRET, payload: { id: "missing" } },
    { id: "test-extension-id", tab: { id: 1 } }
  );

  assert.equal(res.ok, false);
  // If this passes through to session while locked, expected LOCKED instead of FORBIDDEN.
  assert.equal(res.error.code, "LOCKED");
});

test("sw: normal extension page can call VAULT_STATUS", async () => {
  const res = await dispatch(
    { type: MESSAGE_TYPES.VAULT_STATUS },
    { id: "test-extension-id" }
  );

  assert.equal(res.ok, true);
  assert.equal(typeof res.data.hasVault, "boolean");
  assert.equal(typeof res.data.locked, "boolean");
});

test.after(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).chrome = prevChrome;
});
