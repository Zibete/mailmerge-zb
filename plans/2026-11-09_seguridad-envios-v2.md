# Correcciones acotadas de seguridad del envío (V2)

Estado: `LOCAL_VERIFIED` (**322/322 tests offline aprobados**, sintaxis JS y diff verificados). Validación real de Google pendiente. Piloto no ejecutado.

## Defectos y alcance

1. Una edición o intercambio de filas durante la construcción del correo puede dejar `ENVIANDO` en la fila equivocada y enviar a otro destinatario. Releer antes del claim y verificar la identidad/visibilidad después del claim, antes de Gmail. Ante un claim ambiguo, detener y conciliar manualmente.
2. `isRowHiddenByFilter` no observa vistas de filtro. Exigir al operador reconocimiento explícito de la diferencia en la confirmación del envío real; mostrar aviso sin ambigüedad y documentar los filtros admitidos. Sin agregar Sheets API ni scopes.
3. La huella del borrador omite contenido de adjuntos; los vínculos Drive pueden apuntar a archivos editados luego de confirmar. Incluir hash de bytes de adjuntos e imágenes inline, y huella de metadatos/versiones Drive por fila; validar de nuevo antes de Gmail. No exportar todos los Drive en la preparación.

## Criterios de aceptación

- Tests rojos por intercambio durante `buildMessage_` y por movimiento justo después del claim. Sin Gmail en ambas situaciones.
- Envío real por sidebar y servidor bloqueado sin reconocimiento del alcance de filtros; el test a cuenta propia mantiene su flujo.
- Mismo nombre/tamaño pero blob distinto invalida el borrador confirmado; edición de Drive invalida solo la fila, sin envío; no divulgar blobs, URLs ni IDs en mensajes.
- `node --test`, `node --check` y `git diff --check` pasan; sin modificación de scopes ni dependencias.

## Límites conocidos

El servidor no puede conocer la vista de filtro activa del navegador con `SpreadsheetApp`. La seguridad exige consentimiento explícito sobre la lista completa de destinatarios; solo filtros normales y filas ocultas manualmente afectan la selección automática. Sheets no ofrece compare-and-set transaccional en celdas: la nueva verificación minimiza la ventana de carrera, pero durante un envío debe evitarse ordenar o editar la pestaña.
