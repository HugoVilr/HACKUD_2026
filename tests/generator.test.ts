import test from "node:test";
import assert from "node:assert/strict";
import { generatePassword } from "../src/core/generator/generator.ts";

test("generatePassword enforces min/max length", () => {
  assert.equal(generatePassword({ length: 1 }).length, 12);
  assert.equal(generatePassword({ length: 999 }).length, 256);
});

test("generatePassword avoidAmbiguous excludes O0Il1", () => {
  const pw = generatePassword({
    length: 128,
    lower: true,
    upper: true,
    digits: true,
    symbols: false,
    avoidAmbiguous: true
  });

  for (const c of pw) {
    assert.ok(!"O0Il1".includes(c), `unexpected ambiguous character: ${c}`);
  }
});
