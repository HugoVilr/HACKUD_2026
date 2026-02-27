const AMBIGUOUS = new Set(["O", "0", "I", "l", "1"]);

function pickChar(set: string, n: number): string {
  const u = new Uint32Array(1);
  crypto.getRandomValues(u);
  return set[u[0] % n];
}

export function generatePassword(config: {
  length: number;
  lower?: boolean;
  upper?: boolean;
  digits?: boolean;
  symbols?: boolean;
  avoidAmbiguous?: boolean;
}): string {
  const length = Math.max(8, Math.min(128, Math.floor(config.length || 16)));

  const lower = config.lower !== false;
  const upper = config.upper !== false;
  const digits = config.digits !== false;
  const symbols = !!config.symbols;

  let charset = "";
  if (lower) charset += "abcdefghijklmnopqrstuvwxyz";
  if (upper) charset += "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (digits) charset += "0123456789";
  if (symbols) charset += "!@#$%^&*()-_=+[]{};:,.?";

  if (!charset) charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

  if (config.avoidAmbiguous) {
    charset = [...charset].filter((c) => !AMBIGUOUS.has(c)).join("");
  }

  const chars = new Uint8Array(length);
  crypto.getRandomValues(chars);

  let out = "";
  for (let i = 0; i < length; i++) {
    const idx = chars[i] % charset.length;
    out += charset[idx];
  }
  return out;
}