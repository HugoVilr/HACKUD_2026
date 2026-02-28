import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { MESSAGE_TYPES } from "../../src/shared/messages.ts";
import { handleMessage } from "../../src/background/session.ts";

const sha1HexUpper = async (input: string): Promise<string> => {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-1", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
};

test("integration: HIBP_CHECK calls range endpoint and returns count", async () => {
  if (!globalThis.crypto) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).crypto = webcrypto as unknown as Crypto;
  }

  const password = "correct horse battery staple";
  const sha1 = await sha1HexUpper(password);
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prevFetch = (globalThis as any).fetch;

  const seen: { url?: string; headers?: Record<string, string> } = {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async (url: string, init?: any) => {
    seen.url = url;
    seen.headers = init?.headers ?? {};
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async text() {
        return `${suffix}:123\nAAAAA:1\n`;
      }
    };
  };

  try {
    const res = await handleMessage({
      type: MESSAGE_TYPES.HIBP_CHECK,
      payload: { password }
    });

    assert.equal(res.ok, true);
    assert.equal(res.data.count, 123);
    assert.ok(seen.url?.includes(`/range/${prefix}`));
    assert.equal(seen.headers?.["Add-Padding"], "true");
    assert.ok(typeof seen.headers?.["User-Agent"] === "string" && seen.headers["User-Agent"].length > 0);
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = prevFetch;
  }
});

