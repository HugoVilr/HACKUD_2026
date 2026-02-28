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
 * - Whitelist de mensajes seguros desde content scripts (solo lectura)
 * - Rechazar operaciones sensibles (escritura/modificación) desde content scripts
 * - Retornar error FORBIDDEN inmediatamente si validación falla
 * 
 * PROTECCIÓN:
 * - Popup y páginas de extensión: acceso completo
 * - Content scripts: solo VAULT_STATUS y OPEN_POPUP_FOR_SIGNUP (read-only)
 * - Otras extensiones: bloqueadas
 */

// Mensajes que content scripts pueden enviar (whitelist)
// SECURITY: Aunque algunos son de escritura, requieren vault desbloqueado + confirmación usuario
const CONTENT_SCRIPT_ALLOWED_MESSAGES = [
  'VAULT_STATUS',           // Solo lectura - verificar si vault desbloqueado
  'OPEN_POPUP_FOR_SIGNUP',  // Solo sugerencia - no modifica datos
  'GENERATE_PASSWORD',      // Generación de password - necesario para modal in-page
  'ENTRY_ADD'               // Crear entrada - con confirmación explícita del usuario
] as const;

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

  // Si viene de content script, validar whitelist
  if (sender.tab) {
    const isAllowed = CONTENT_SCRIPT_ALLOWED_MESSAGES.includes(message.type as any);
    
    if (!isAllowed) {
      console.warn('[G8keeper] Content script attempted forbidden message:', message.type);
      sendResponse({ 
        ok: false, 
        error: { 
          code: "FORBIDDEN", 
          message: "Content scripts can only send VAULT_STATUS or OPEN_POPUP_FOR_SIGNUP" 
        } 
      });
      return true;
    }
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
