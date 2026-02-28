import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const testsRoot = path.join(repoRoot, "tests");

const collectTestFiles = (dir) => {
  const out = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTestFiles(fullPath));
      continue;
    }
    if (!entry.isFile()) continue;
    if (fullPath.endsWith(".test.ts")) out.push(fullPath);
  }
  return out;
};

const run = (args) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
  });

const probe = (args) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: "ignore" });
    child.on("exit", (code) => resolve(code ?? 1));
  });

const main = async () => {
  if (!existsSync(testsRoot) || !statSync(testsRoot).isDirectory()) {
    console.error(`Missing tests directory: ${testsRoot}`);
    process.exit(1);
  }

  const testFiles = collectTestFiles(testsRoot);
  if (testFiles.length === 0) {
    console.error(`No test files found under: ${testsRoot}`);
    process.exit(1);
  }

  // Prefer Node native TS stripping if available.
  if ((await probe(["--experimental-strip-types", "--version"])) === 0) {
    const code = await run(["--test", "--experimental-strip-types", ...testFiles]);
    process.exit(code);
  }

  const tsxInstalled = existsSync(new URL("../node_modules/tsx/package.json", import.meta.url));
  if (!tsxInstalled) {
    console.error(
      "Missing dev dependency: tsx.\n" +
        "Install it with: npm install\n" +
        "Then rerun: npm test\n" +
        "(Or upgrade Node to a version that supports --experimental-strip-types.)"
    );
    process.exit(1);
  }

  // Fallback: use tsx as an import hook (requires `npm i -D tsx`).
  // Node 20+ supports `--import`; older versions may require `--loader`.
  let code = await run(["--test", "--import=tsx", ...testFiles]);
  if (code === 0) process.exit(0);

  code = await run(["--test", "--loader=tsx", ...testFiles]);
  process.exit(code);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
