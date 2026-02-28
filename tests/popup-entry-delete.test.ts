import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function load(relPath: string): string {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("entry detail includes delete button next to edit actions", () => {
  const src = load("src/popup/popup.tsx");
  const detailIndex = src.indexOf("const renderEntryDetail = () => {");
  assert.ok(detailIndex >= 0, "renderEntryDetail() should exist");
  const detailBlock = src.slice(detailIndex, detailIndex + 1200);
  assert.ok(detailBlock.includes('data-action="to-edit"'), "detail actions should include edit button");
  assert.ok(detailBlock.includes('data-action="delete-entry"'), "detail actions should include delete button");
  assert.ok(detailBlock.includes('class="caution-button"'), "delete button should reuse caution style");
});

test("delete-entry action requires explicit confirmation", () => {
  const src = load("src/popup/popup.tsx");
  const actionIndex = src.indexOf('if (action === "delete-entry") {');
  assert.ok(actionIndex >= 0, "delete-entry action handler should exist");
  const actionBlock = src.slice(actionIndex, actionIndex + 1300);
  assert.ok(actionBlock.includes("window.confirm("), "delete-entry should ask for confirmation");
  assert.ok(actionBlock.includes("if (!confirmed) {"), "delete-entry should abort when user cancels");
});

test("delete-entry action deletes selected entry and returns to list", () => {
  const src = load("src/popup/popup.tsx");
  const actionIndex = src.indexOf('if (action === "delete-entry") {');
  assert.ok(actionIndex >= 0, "delete-entry action handler should exist");
  const actionBlock = src.slice(actionIndex, actionIndex + 1800);
  assert.ok(
    actionBlock.includes('await sendApiMessage("ENTRY_DELETE", { id: entry.id });'),
    "delete-entry should call ENTRY_DELETE with selected id"
  );
  assert.ok(actionBlock.includes('state.screen = "LIST";'), "delete-entry should navigate back to list on success");
  assert.ok(actionBlock.includes('await refreshEntries();'), "delete-entry should refresh entries after deletion");
});
