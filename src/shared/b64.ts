export function u8ToB64(u8: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
}

export function b64ToU8(b64: string): Uint8Array {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export function abToB64(ab: ArrayBuffer): string {
  return u8ToB64(new Uint8Array(ab));
}

export function b64ToAb(b64: string): ArrayBuffer {
  return b64ToU8(b64).buffer;
}