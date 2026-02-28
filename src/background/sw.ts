import type { AnyRequestMessage, MessageResponseMap, MessageType } from "../shared/messages.ts";
import { handleMessage } from "./session.ts";

/**
 * SECURITY FIX #18: Validación de origen de mensajes
 * 
 * VULNERABILIDAD ENCONTRADA:
 * - No se validaba el origen de los mensajes chrome.runtime.sendMessage()
 * - Sin validación explícita del sender.id
 * - Potencial cross-extension messaging o content script malicioso
 * 
 * RIESGO:
 * - ALTO: Otra extensión comprometida podría intentar acceder al vault
 * - Content scripts maliciosos podrían intentar enviar comandos
 * - Falta de defense-in-depth (aunque Chrome ya aísla, debemos validar)
 * 
 * SOLUCIÓN IMPLEMENTADA:
 * - Validar que sender.id coincide con chrome.runtime.id (misma extensión)
 * - Rechazar mensajes desde content scripts (sender.tab presente)
 * - Retornar error FORBIDDEN inmediatamente si validación falla
 * 
 * PROTECCIÓN:
 * - Solo el popup y otras páginas de la extensión pueden comunicarse
 * - Content scripts en páginas web: bloqueados
 * - Otras extensiones: bloqueadas
 */
chrome.runtime.onMessage.addListener((message: AnyRequestMessage, sender, sendResponse) => {
  // Validar que el mensaje viene de la propia extensión
  if (!sender.id || sender.id !== chrome.runtime.id) {
    sendResponse({ 
      ok: false, 
      error: { 
        code: "FORBIDDEN", 
        message: "Invalid message origin" 
      } 
    });
    return true;
  }

  // Rechazar mensajes desde content scripts (tabs/páginas web)
  if (sender.tab) {
    sendResponse({ 
      ok: false, 
      error: { 
        code: "FORBIDDEN", 
        message: "Content scripts are not allowed to communicate with vault" 
      } 
    });
    return true;
  }

  handleMessage(message)
    .then((result) => {
      sendResponse(result as MessageResponseMap[MessageType]);
    })
    .catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      sendResponse({ ok: false, error: { code: "UNHANDLED_ERROR", message: msg } });
    });

  return true;
});
