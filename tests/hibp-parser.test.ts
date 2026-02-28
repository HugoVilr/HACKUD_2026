import test from "node:test";
import assert from "node:assert/strict";
import { parseHibpRangeResponse } from "../src/core/hibp/hibp.ts";

test("parseHibpRangeResponse returns 0 when suffix not present", () => {
  const body = ["AAAAA:1", "BBBBB:2", ""].join("\n");
  assert.equal(parseHibpRangeResponse(body, "CCCCC"), 0);
});

test("parseHibpRangeResponse matches suffix case-insensitively and parses count", () => {
  const body = ["abcde:42", "fffff:2"].join("\n");
  assert.equal(parseHibpRangeResponse(body, "ABCDE"), 42);
});

test("parseHibpRangeResponse tolerates CRLF and whitespace", () => {
  const body = "  AAAA1:7\r\nBBBBB:2\r\n";
  assert.equal(parseHibpRangeResponse(body, "AAAA1"), 7);
});
