function toHex(u8: Uint8Array): string {
  return [...u8].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

/**
 * SECURITY FIX #10: HIBP timeout y manejo de errores robusto
 * 
 * VULNERABILIDAD ENCONTRADA:
 * - fetch() sin timeout podía colgarse indefinidamente
 * - No había AbortController para cancelar requests lentas
 * - Sin retry logic ni manejo de rate limiting
 * - UX pobre si HIBP está caído o lento
 * 
 * RIESGO:
 * - MEDIO: DoS accidental / UX pobre
 * - Usuario esperando indefinidamente sin feedback
 * - Posible bloqueo de la UI si el request nunca retorna
 * 
 * SOLUCIÓN IMPLEMENTADA:
 * - Timeout de 10 segundos con AbortController
 * - Manejo específico de HTTP 429 (rate limiting)
 * - Errores descriptivos para debugging
 * - Cleanup automático del timeout
 * 
 * NOTA IMPORTANTE:
 * - HIBP puede retornar 403 si no enviamos User-Agent (ya implementado)
 * - Add-Padding mejora privacidad (k-anonymity reforzado)
 */
export async function hibpCheck(password: string): Promise<number> {
  // SHA-1(password) local - NUNCA enviamos el password completo
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-1", data);
  const sha1 = toHex(new Uint8Array(digest));

  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  // Configurar timeout con AbortController
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000); // 10 segundos

  try {
    // Range query (k-anonymity): solo enviamos los primeros 5 caracteres del hash
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "Add-Padding": "true",
        "User-Agent": "Seeking the Perfect Key (HackUDC 2026)"
      }
    });

    clearTimeout(timeoutId);

    // Manejo específico de errores HTTP
    if (!res.ok) {
      if (res.status === 429) {
        throw new Error("HIBP_RATE_LIMITED: Demasiadas peticiones, intenta más tarde");
      }
      if (res.status === 403) {
        throw new Error("HIBP_FORBIDDEN: Verifica el User-Agent");
      }
      throw new Error(`HIBP_HTTP_${res.status}`);
    }

    const text = await res.text();
    
    // Formato de respuesta: SUFFIX:COUNT (una por línea)
    // Con Add-Padding, HIBP añade líneas dummy para ofuscar el tamaño real
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
    
    // No encontrado = 0 filtraciones (password no conocida públicamente)
    return 0;
    
  } catch (e: any) {
    clearTimeout(timeoutId);
    
    // Manejo específico del timeout
    if (e.name === "AbortError") {
      throw new Error("HIBP_TIMEOUT: La petición tardó demasiado (>10s)");
    }
    
    // Re-lanzar otros errores con contexto
    throw e;
  }
}