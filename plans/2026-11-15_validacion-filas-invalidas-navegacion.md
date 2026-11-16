# 2026-11-15 — Validación de filas inválidas y navegación del panel

## Evidencia y problema
En la prueba real, la validación mostró 4 filas elegibles y 1 inválida por adjunto inaccesible, pero el paso 2 se marcó en verde y permitió avanzar automáticamente. La confirmación de envío listó solo las 4 válidas, sin indicar que existía otra pendiente. "Ir a Envío" abrió el paso 4 sin actualizar el indicador del riel.

## Decisión de alcance
- **Fallar de forma cerrada al preparar envíos:** si hay filas pendientes inválidas, no se emite token de confirmación para envío real. Informar cantidad y números de fila, sin incluir datos personales ni enlaces. El operador debe corregirlas o escribir `SKIP` en `Resultado` y volver a validar. **La prueba individual de una fila válida sigue disponible.**
- **No registrar errores de validación en la hoja:** `Validar` conserva el contrato de solo lectura. No inventar un nuevo estado para `Resultado` ni inmovilizar filas automáticamente. La hoja sigue siendo fuente de verdad de envíos intentados, no de prevalidaciones.
- **No avance automático engañoso:** con errores de fila el paso 2 permanece abierto, presenta estado bloqueado y explica cómo resolverlo. Los errores globales y el plan de columnas conservan precedencia.
- **Navegación:** el punto activo del riel refleja la sección abierta; los puntos completados reflejan únicamente el progreso real, por lo que el paso opcional de prueba no se marca como completado por entrar al envío.
- No cambian esquema, scopes, motor de envío, confirmación por token, lógica de adjuntos, ni contratos de los resultados.

## Cambios mínimos
1. `src/Confirmation.js`: guard de filas inválidas antes de crear el token de envío.
2. `src/Sidebar.html`: fase bloqueada con errores, estado del paso 2 y guía visible; actualizar riel al navegar sin tocar el control del envío.
3. Tests de rechazo seguro, de navegación al paso 4 y de validación con y sin errores; actualizar las expectativas afectadas.
4. Solo documentación operativa y registro de decisión pertinentes.

## Aceptación
- Con 4 válidas y 1 inválida, se ven ambas cantidades, el paso 2 no aparece en verde, el paso 3 no se abre automáticamente, y Revisar envío no prepara un envío parcial. Cero `cache.put`, cero escrituras y cero mensajes.
- Si la inválida se corrige o se marca `SKIP`, una nueva validación permite avanzar y preparar solo las filas válidas.
- Sin errores, el flujo original y la prueba opcional funcionan.
- "Ir a Envío" y pulsar directamente el encabezado 4 iluminan el punto 4 sin marcar el 3 como completado.
- Suite `node --test`, checks de sintaxis y `git diff --check`. Prueba en Google Sheets queda pendiente; no ejecutar `clasp` ni enviar correos reales.
