import type { ApiResponse, RequestMessage } from "../../shared/messages";

/**
 * TODO (PERSONA 2 - FRONTEND): Consideraciones de seguridad importantes
 * 
 * SECURITY NOTE #7 & #15: Manejo seguro de passwords en el popup
 * 
 * RESPONSABILIDADES DEL FRONTEND:
 * 
 * 1. LIMPIEZA DE PASSWORDS EN MEMORIA:
 *    - Cuando recibas un password del background (ENTRY_GET_SECRET):
 *      ```
 *      const response = await sendToBackground<{ secret: { password: string } }>(msg);
 *      let password = response.data.secret.password;
 *      
 *      // Usar el password (copiar, mostrar, etc.)
 *      await navigator.clipboard.writeText(password);
 *      
 *      // Limpiar inmediatamente después de usar
 *      password = "\0".repeat(password.length);
 *      password = "";
 *      ```
 * 
 * 2. CLIPBOARD TIMEOUT:
 *    - Implementar limpieza automática del clipboard tras 30-60 segundos:
 *      ```
 *      await navigator.clipboard.writeText(password);
 *      
 *      setTimeout(async () => {
 *        const current = await navigator.clipboard.readText();
 *        if (current === password) {
 *          await navigator.clipboard.writeText(""); // Limpiar
 *        }
 *      }, 30_000); // 30 segundos
 *      ```
 * 
 * 3. AUTO-HIDE DE PASSWORDS MOSTRADOS:
 *    - Si muestras passwords en pantalla (modo "reveal"):
 *      - Usar timeout para auto-ocultar tras 30s
 *      - Limpiar la variable del estado de React
 *      - Considerar blur/focus events para ocultar automáticamente
 * 
 * 4. NO LOGGEAR NUNCA:
 *    - JAMÁS hacer console.log() de passwords o master passwords
 *    - Cuidado con React DevTools en desarrollo
 *    - Desactivar logging en producción
 * 
 * 5. VALIDACIÓN DE INPUT:
 *    - Sanitizar inputs antes de enviar al background
 *    - Validar respuestas del background (type guards)
 *    - Manejar errores sin exponer información sensible
 * 
 * 6. CSP COMPLIANCE:
 *    - No usar eval() ni Function() constructor
 *    - No inline scripts en HTML
 *    - Todos los scripts deben venir de archivos .js/.ts compilados
 * 
 * 7. FEEDBACK VISUAL DE SEGURIDAD:
 *    - Mostrar indicador cuando el vault está desbloqueado
 *    - Timer visible de auto-lock (opcional pero recomendado)
 *    - Confirmación antes de revelar passwords
 *    - Iconos de "copiado" que desaparecen automáticamente
 */

export function sendToBackground<T>(msg: RequestMessage): Promise<ApiResponse<T>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res: ApiResponse<T>) => resolve(res));
  });
}