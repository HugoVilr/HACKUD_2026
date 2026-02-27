function toHex(u8: Uint8Array): string {
  return [...u8].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export async function hibpCheck(password: string): Promise<number> {
  // SHA-1(password) local
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-1", data);
  const sha1 = toHex(new Uint8Array(digest));

  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  // Range query (k-anonymity)
  const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
    method: "GET",
    headers: {
      "Add-Padding": "true",
      "User-Agent": "Seeking the Perfect Key (HackUDC 2026)"
    }
  });

  if (!res.ok) throw new Error(`HIBP_HTTP_${res.status}`);

  const text = await res.text();
  // Formato: SUFFIX:COUNT (una por línea)
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [hashSuffix, countStr] = trimmed.split(":");
    if (hashSuffix?.toUpperCase() === suffix) {
      const count = Number(countStr);
      return Number.isFinite(count) ? count : 0;
    }
  }
  return 0;
}