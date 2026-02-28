import test from "node:test";
import assert from "node:assert/strict";

import { handlePopupActionClick } from "../src/popup/app/handlers/popupHandlers.ts";
import { createInitialPopupState } from "../src/popup/app/state/popupState.ts";
import { renderRouteBody } from "../src/popup/ui/screens/renderers.ts";

const createDeps = () => {
  const state = createInitialPopupState();

  return {
    state,
    deps: {
      root: { addEventListener() {} } as unknown as HTMLElement,
      state,
      render: () => {},
      setToast: () => {},
      sendApiMessage: async () => ({ ok: true, data: {} }),
      refreshStatus: async () => {},
      refreshEntries: async () => true,
      ensureSelectedSecret: async () => null,
      saveRecoveryCodesContext: async () => {},
      consumeSignupUnlockContext: async () => false,
      getSelectedEntry: () => state.entries.find((entry) => entry.id === state.selectedEntryId) ?? null,
      selectEntry: (entryId: string) => {
        state.selectedEntryId = entryId;
        state.screen = "DETAIL";
      },
      copyText: async () => {},
      recoveryCodesKey: "g8keeper_recovery_codes_context",
    },
  };
};

test("entry detail includes delete button next to edit actions", () => {
  const { state } = createDeps();
  state.route = "UNLOCKED";
  state.screen = "DETAIL";
  state.entries = [
    {
      id: "entry-1",
      title: "GitHub",
      username: "me",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  state.selectedEntryId = "entry-1";

  const html = renderRouteBody(state, {
    escapeHtml: (v) => String(v),
    maskPassword: (v) => "*".repeat(v.length || 8),
    getSelectedEntry: () => state.entries[0],
  });

  assert.ok(html.includes('data-action="to-edit"'), "detail actions should include edit button");
  assert.ok(html.includes('data-action="delete-entry"'), "detail actions should include delete button");
  assert.ok(html.includes('class="caution-button"'), "delete button should reuse caution style");
});

test("delete-entry action requires explicit confirmation", async () => {
  const { state, deps } = createDeps();
  state.route = "UNLOCKED";
  state.screen = "DETAIL";
  state.entries = [
    {
      id: "entry-1",
      title: "GitHub",
      username: "me",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  state.selectedEntryId = "entry-1";

  let apiCalled = false;
  deps.sendApiMessage = async () => {
    apiCalled = true;
    return { ok: true, data: {} };
  };

  const previousWindow = (globalThis as any).window;
  (globalThis as any).window = {
    confirm: () => false,
  };

  await handlePopupActionClick("delete-entry", null, deps);

  assert.equal(apiCalled, false, "delete-entry should not call API when user cancels");

  (globalThis as any).window = previousWindow;
});

test("delete-entry action deletes selected entry and returns to list", async () => {
  const { state, deps } = createDeps();
  state.route = "UNLOCKED";
  state.screen = "DETAIL";
  state.entries = [
    {
      id: "entry-1",
      title: "GitHub",
      username: "me",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  state.selectedEntryId = "entry-1";

  let deletedId = "";
  let refreshed = false;
  deps.sendApiMessage = async (type, payload) => {
    if (type === "ENTRY_DELETE") {
      deletedId = String((payload as { id?: string })?.id || "");
    }
    return { ok: true, data: {} };
  };
  deps.refreshEntries = async () => {
    refreshed = true;
    return true;
  };

  const previousWindow = (globalThis as any).window;
  (globalThis as any).window = {
    confirm: () => true,
  };

  await handlePopupActionClick("delete-entry", null, deps);

  assert.equal(deletedId, "entry-1", "delete-entry should call ENTRY_DELETE with selected id");
  assert.equal(state.screen, "LIST", "delete-entry should navigate back to list on success");
  assert.equal(refreshed, true, "delete-entry should refresh entries after deletion");

  (globalThis as any).window = previousWindow;
});
