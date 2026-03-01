import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInitialPopupState } from "../src/popup/app/state/popupState.ts";
import { handleUnlockVaultSubmit } from "../src/popup/app/handlers/popupHandlers.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function load(relPath: string): string {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("credential-assistant defines unlock wait flow after opening popup", () => {
  const src = load("src/content/credential-assistant.ts");
  assert.ok(src.includes("async function waitForVaultUnlock"), "should define waitForVaultUnlock()");
  assert.ok(
    src.includes("await openUnlockPopupForSignup();") && src.includes("await waitForVaultUnlock(60_000);"),
    "should open popup and wait for unlock automatically"
  );
  assert.ok(
    src.includes("payload: { source: 'signup' }"),
    "should open popup with signup source context"
  );
});

test("credential-assistant closes signup notification immediately on accept", () => {
  const src = load("src/content/credential-assistant.ts");
  const acceptIndex = src.indexOf("acceptBtn?.addEventListener('click', async () => {");
  assert.ok(acceptIndex >= 0, "accept click handler should exist");
  const slice = src.slice(acceptIndex, acceptIndex + 500);
  const removeIndex = slice.indexOf("remove();");
  const unlockedIndex = slice.indexOf("const unlocked = await isVaultUnlocked();");
  assert.ok(removeIndex >= 0, "remove() should be called in accept handler");
  assert.ok(unlockedIndex >= 0, "vault status check should exist in accept handler");
  assert.ok(removeIndex < unlockedIndex, "notification should close before unlock checks");
});

test("credential-assistant no longer blocks signup suggestions when vault is locked", () => {
  const src = load("src/content/credential-assistant.ts");
  assert.ok(src.includes("async function monitorForms(): Promise<void> {"), "monitorForms() should exist");
  assert.equal(
    src.includes("const unlocked = await isVaultUnlocked();\n  if (!unlocked) {\n    return;"),
    false,
    "monitorForms should not early-return when vault is locked"
  );
});

test("credential-assistant stores normalized domain in ENTRY_ADD payloads", () => {
  const src = load("src/content/credential-assistant.ts");
  assert.ok(src.includes("function currentDomain()"), "currentDomain() helper should exist");
  assert.ok(
    src.includes("domain: currentDomain(),"),
    "ENTRY_ADD payloads should include normalized domain"
  );
});

test("credential-assistant chooses best target form for AUTOFILL_CREDENTIALS", () => {
  const src = load("src/content/credential-assistant.ts");
  assert.ok(src.includes("function findBestAutofillTarget"), "should define form targeting helper");
  assert.ok(
    src.includes("const target = findBestAutofillTarget(forms);"),
    "AUTOFILL_CREDENTIALS handler should use target form selection"
  );
  assert.ok(
    src.includes("findFallbackUsernameField(form, passwordField)"),
    "AUTOFILL_CREDENTIALS handler should include username fallback lookup"
  );
});

test("popup closes extension window after successful unlock", async () => {
  const state = createInitialPopupState();
  const deps = {
    root: { addEventListener() {} } as unknown as HTMLElement,
    state,
    render: () => {},
    setToast: () => {},
    sendApiMessage: async () => ({ ok: true, data: {} }),
    refreshStatus: async () => {},
    refreshEntries: async () => true,
    ensureSelectedSecret: async () => null,
    saveRecoveryCodesContext: async () => {},
    consumeSignupUnlockContext: async () => true,
    getSelectedEntry: () => null,
    selectEntry: () => {},
    copyText: async () => {},
    recoveryCodesKey: "g8keeper_recovery_codes_context",
  };

  let closeCalled = false;
  const previousWindow = (globalThis as any).window;
  (globalThis as any).window = {
    close: () => {
      closeCalled = true;
    },
  };

  const data = new FormData();
  data.set("master", "correct horse battery staple");

  await handleUnlockVaultSubmit(data, deps);
  await new Promise((resolve) => setTimeout(resolve, 110));
  assert.equal(closeCalled, true, "unlock success path should close popup");
  (globalThis as any).window = previousWindow;
});

test("service worker stores signup popup context before opening popup", () => {
  const src = load("src/background/sw.ts");
  assert.ok(src.includes('const POPUP_CONTEXT_KEY = "g8keeper_popup_context";'));
  assert.ok(src.includes('if (source === "signup") {'));
  assert.ok(src.includes("chrome.storage.session.set("));
});
