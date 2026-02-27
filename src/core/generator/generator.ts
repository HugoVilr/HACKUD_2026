const AMBIGUOUS = new Set(["O", "0", "I", "l", "1"]);

/**
 * SECURITY FIX #9: Generador sin sesgo (Rejection Sampling)
 * 
 * VULNERABILIDAD ENCONTRADA:
 * - `value % charset.length` introducía sesgo si charset.length no divide 256
 * - Ejemplo: charset de 60 chars → primeros 4 chars aparecen más frecuentemente
 * - Reducción medible de entropía real
 * 
 * RIESGO:
 * - BAJO-MEDIO: Reduce entropía efectiva de passwords generadas
 * - Algunos caracteres más probables que otros
 * - Facilita ataques estadísticos a largo plazo
 * 
 * SOLUCIÓN IMPLEMENTADA:
 * - Rejection sampling: rechazar valores >= max múltiplo de charset.length
 * - Garantiza distribución uniforme perfecta
 * - Costo computacional mínimo (1-2 iteraciones en promedio)
 * 
 * EJEMPLO:
 * - charset.length = 60, max = 240 (mayor múltiplo de 60 < 256)
 * - Si random byte >= 240, rechazamos y volvemos a intentar
 * - Todos los chars tienen exactamente la misma probabilidad: 1/60
 */
function pickCharUnbiased(charset: string): string {
  const len = charset.length;
  const max = Math.floor(256 / len) * len; // Mayor múltiplo de len que cabe en 256
  
  // Rejection sampling: rechazar valores fuera del rango uniforme
  while (true) {
    const arr = new Uint8Array(1);
    crypto.getRandomValues(arr);
    
    if (arr[0] < max) {
      return charset[arr[0] % len];
    }
    // Si arr[0] >= max, rechazamos y volvemos a intentar
    // Esto ocurre en ~6% de los casos en el peor escenario (charset.length = 128)
  }
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

  // Generar password con rejection sampling (sin sesgo)
  let out = "";
  for (let i = 0; i < length; i++) {
    out += pickCharUnbiased(charset);
  }
  
  return out;
}