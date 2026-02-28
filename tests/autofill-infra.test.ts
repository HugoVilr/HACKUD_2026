import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadJson<T>(relPath: string): T {
  const abs = path.join(repoRoot, relPath);
  const raw = readFileSync(abs, "utf8");
  return JSON.parse(raw) as T;
}

test("manifest declares content script for autofill", () => {
  const manifest = loadJson<any>("manifest.json");
  assert.equal(manifest.manifest_version, 3);

  assert.ok(Array.isArray(manifest.content_scripts), "content_scripts should exist");
  assert.ok(manifest.content_scripts.length > 0, "content_scripts should not be empty");

  const autofillEntry = manifest.content_scripts.find((entry: any) =>
    Array.isArray(entry?.js) && entry.js.includes("src/content/autofill.js")
  );

  assert.ok(autofillEntry, "manifest should include src/content/autofill.js in content_scripts");
  assert.ok(Array.isArray(autofillEntry.matches), "matches should exist");
  assert.ok(
    autofillEntry.matches.includes("<all_urls>"),
    "manifest should match <all_urls> for content script coverage"
  );
  assert.ok(
    Array.isArray(autofillEntry.css) && autofillEntry.css.includes("src/content/autofill.css"),
    "manifest should include src/content/autofill.css in content_scripts"
  );
  assert.equal(autofillEntry.run_at, "document_idle");
});

test("manifest includes required permission for scripting", () => {
  const manifest = loadJson<any>("manifest.json");
  assert.ok(Array.isArray(manifest.permissions), "permissions should exist");
  assert.ok(manifest.permissions.includes("storage"), "storage permission should be present");
  assert.ok(manifest.permissions.includes("scripting"), "scripting permission should be present");
});

test("build script compiles autofill content script", () => {
  const pkg = loadJson<any>("package.json");
  const buildCmd = String(pkg?.scripts?.build ?? "");
  assert.ok(buildCmd.includes("src/content/autofill.ts"), "build script should compile autofill.ts");
  assert.ok(buildCmd.includes("--outfile=src/content/autofill.js"), "build script should write autofill.js output");
});

test("autofill source file exists", () => {
  const abs = path.join(repoRoot, "src/content/autofill.ts");
  assert.equal(existsSync(abs), true, "src/content/autofill.ts should exist");
});

test("autofill style file exists", () => {
  const abs = path.join(repoRoot, "src/content/autofill.css");
  assert.equal(existsSync(abs), true, "src/content/autofill.css should exist");
});
