import { MSG } from "../shared/messages";
import { handleMessage } from "./session";

/**
 * SECURITY FIX #5: Validación de origen de mensajes
 * 
 * VULNERABILIDAD ENCONTRADA:
 * - Cualquier página web o content script podía enviar mensajes a la extensión
 * - No se verificaba el origen del sender (sender.id, sender.url)
 * - Superficie de ataque externa: código malicioso podría intentar extraer datos
 * 
 * RIESGO:
 * - CRÍTICO: Un atacante con el extension ID podría enviar comandos arbitrarios
 * - Posibilidad de exfiltración de datos o manipulación del vault desde páginas web
 * 
 * SOLUCIÓN IMPLEMENTADA:
 * - Validar que el mensaje viene de la propia extensión (sender.id === chrome.runtime.id)
 * - Rechazar mensajes de tabs externos o URLs no autorizadas
 * - Solo permitir comunicación desde componentes internos de la extensión
 */
chrome.runtime.onMessage.addListener((message: any, sender, sendResponse) => {
  // Validación de origen: solo aceptar mensajes de nuestra propia extensión
  if (!sender.id || sender.id !== chrome.runtime.id) {
    sendResponse({ 
      ok: false, 
      error: { code: "FORBIDDEN", message: "Origen no autorizado" } 
    });
    return;
  }

  // Bloquear mensajes desde tabs (páginas web con content scripts)
  // Solo permitir desde componentes internos (popup, options, etc.)
  if (sender.tab) {
    sendResponse({ 
      ok: false, 
      error: { code: "FORBIDDEN", message: "No se permiten mensajes desde tabs" } 
    });
    return;
  }

  (async () => {
    try {
      const res = await handleMessage(message);
      sendResponse(res);
    } catch {
      sendResponse({ ok: false, error: { code: "INTERNAL", message: "Error interno" } });
    }
  })();

  return true; // async
});