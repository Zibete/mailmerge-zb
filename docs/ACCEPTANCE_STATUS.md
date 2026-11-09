# Estado de aceptación — Mail Merge V1

**Nivel alcanzado: `LOCAL_VERIFIED`.** No es `LIVE_VERIFIED`: ninguna prueba se ejecutó contra Google (sin `clasp`, sin OAuth, sin envíos reales, ni siquiera de prueba). Los tests usan servicios simulados (`tests/helpers/fakes.js`) y el fixture sintético de `docs/ACCEPTANCE.md` (`tests/fixtures/campaign.js`). Un test local que pasa no prueba la integración con Google: las partes que dependen del runtime de Apps Script, Gmail o Drive se listan al final como `PENDING LIVE VALIDATION`.

Fecha de la verificación: 2026-11-09. Plan: `plans/2026-11-08_mail-merge-v1.md`. Guía de operación: [`OPERATIONS.md`](OPERATIONS.md).

## Leyenda

- `PASS (local mock)`: cubierto por tests automáticos que pasan con servicios simulados. En AC-29 y AC-30 la evidencia es la salida de comandos locales, no un mock.
- `FAIL`: un test que lo cubre falla. **No hay ninguno.**
- `PENDING LIVE VALIDATION`: no se puede comprobar localmente.
- Columna "En vivo": número del ítem de la checklist [`PENDING LIVE VALIDATION`](#verificaciones-en-vivo-pendientes) que completa ese criterio en el runtime real, si corresponde.

Valores de compatibilidad: `docs/ACCEPTANCE.md` usa `SENDING`, `REVIEW` y `[TEST]`; esta implementación usa `ENVIANDO`, `REVISAR` y `[PRUEBA] ` (ver `CLAUDE.md`).

## Resultado de la suite

Comando (desde la raíz del proyecto, Git Bash, Node portable v20.11.1, sin red ni credenciales):

```bash
export PATH="/c/Users/matias.peralta_exter/nodejs/node-v20.11.1-win-x64:$PATH" && node --test
```

Resumen real:

```text
1..153
# tests 153
# suites 0
# pass 153
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Por archivo: `attachments.test.js` 12, `manifest.test.js` 5, `preflight.test.js` 19, `send.test.js` 26, `services.test.js` 19, `sheet.test.js` 16, `template.test.js` 13, `test-send.test.js` 12, `ui.test.js` 31.

## Criterios AC-01 a AC-31

| ID | Criterio | Estado | Tests que lo cubren (archivo: título) | En vivo |
|---|---|---|---|---|
| AC-01 | Dos filas con valores distintos: asuntos y cuerpos distintos, sin fuga entre filas | `PASS (local mock)` | `tests/template.test.js`: "AC-01: dos filas distintas producen asuntos y cuerpos distintos sin fuga entre filas" | — |
| AC-02 | `<script>`, `&`, comillas y salto de línea: HTML escapado, asunto sin CR/LF | `PASS (local mock)` | `tests/template.test.js`: "AC-02: el HTML escapa el valor, el asunto no tiene CR/LF y el texto plano conserva el valor crudo"; "AC-02: escapeHtml_ y sanitizeHeaderValue_ tratan cada carácter especial" | 6 |
| AC-03 | Marcador desconocido `{{Not a column}}`: fila bloqueada, no se reemplaza por vacío | `PASS (local mock)` | `tests/template.test.js`: "AC-03: un marcador que no es un encabezado bloquea la fila y no se reemplaza por vacío"; `tests/preflight.test.js`: "AC-03: un marcador desconocido en la plantilla es error global y no deja filas válidas" | — |
| AC-04 | Marcador con valor vacío: fila bloqueada con motivo accionable | `PASS (local mock)` | `tests/template.test.js`: "AC-04: un marcador con valor vacío o solo espacios bloquea la fila" | — |
| AC-05 | Dos enlaces de Drive separados por coma: exactamente esos dos archivos | `PASS (local mock)` | `tests/attachments.test.js`: "R-05 / AC-05: dos enlaces separados por coma, con espacios y una pieza vacía, dan exactamente esos dos IDs en orden"; `tests/test-send.test.js`: "AC-05 / AC-06 / AC-08: buildMessage_ adjunta el común y exactamente los archivos de la fila"; `tests/services.test.js`: "AC-05: drive.getAttachment descarga un binario con getBlob sin conversión" | 7, 10 |
| AC-06 | Adjunto común + adjunto de la fila; el de otra fila nunca aparece | `PASS (local mock)` | `tests/test-send.test.js`: "AC-05 / AC-06 / AC-08: buildMessage_ adjunta el común y exactamente los archivos de la fila" | 6 |
| AC-07 | Archivo de Drive inexistente o sin acceso: fila inválida, sin llamada a Gmail | `PASS (local mock)` | `tests/preflight.test.js`: "AC-07: un adjunto inexistente o sin acceso invalida solo esa fila"; "AC-07: un adjunto en la papelera o de tipo no soportado invalida la fila"; `tests/send.test.js`: "AC-07 / AC-13: filas inválidas en la validación nunca llegan a Gmail en el envío real"; `tests/services.test.js`: "AC-07: drive.getFileInfo lanza si el archivo no existe" | — |
| AC-08 | Documento nativo: exportación a PDF con nombre y MIME correctos | `PASS (local mock)` | `tests/attachments.test.js`: "AC-08 (unidad): classifyDriveFile_ exporta a PDF documentos, hojas y presentaciones"; "AC-08 (unidad): classifyDriveFile_ usa el blob original para un PDF"; "AC-08 (unidad): classifyDriveFile_ rechaza formularios, carpetas y archivos en la papelera"; `tests/test-send.test.js`: "AC-05 / AC-06 / AC-08: buildMessage_ adjunta el común y exactamente los archivos de la fila"; `tests/services.test.js`: "AC-08: drive.getAttachment exporta un nativo con getAs(application/pdf) y nombre .pdf" | 7 |
| AC-09 | Adjuntos por encima del límite configurado: sin llamada a Gmail, error accionable | `PASS (local mock)` | `tests/attachments.test.js`: "AC-09 (unidad): checkAttachmentSizes_ acepta por debajo y en el máximo"; "AC-09 (unidad): checkAttachmentSizes_ por encima del máximo devuelve un error accionable"; "AC-09 (unidad): checkAttachmentSizes_ falla cerrado con un tamaño desconocido"; `tests/preflight.test.js`: "AC-09: adjuntos binarios más comunes por encima del límite invalidan la fila"; `tests/test-send.test.js`: "AC-09: buildMessage_ controla el tamaño total con el PDF exportado"; `tests/send.test.js`: "AC-09: un PDF exportado que supera el límite en la Fase B omite la fila sin claim ni envío" | 7 |
| AC-10 | `SKIP`, `Email Sent`, `REVISAR`, `ENVIANDO` o cualquier estado no vacío: excluidos | `PASS (local mock)` | `tests/sheet.test.js`: "AC-10: filas con estado no vacío quedan excluidas con su motivo; estado vacío es elegible"; "AC-10: una fila totalmente vacía no aparece en ninguna lista y suma a blankRows" | — |
| AC-11 | Fila oculta por el usuario o por un filtro: excluida de la validación y del envío | `PASS (local mock)` | `tests/sheet.test.js`: "AC-11: filas ocultas por el usuario o por un filtro quedan excluidas aun con estado vacío"; `tests/services.test.js`: "AC-11: readSheet lee valores mostrados y filas ocultas por fila (índice 0 = false)"; `tests/send.test.js`: "AC-11: filas ocultas por el usuario o por un filtro no entran en la validación ni en el envío real" | 8 |
| AC-12 | Encabezado duplicado o falta de `Email Address` / `Mail Merge Status`: la validación falla, sin envío | `PASS (local mock)` | `tests/sheet.test.js`: "AC-12: mapHeaders_ rechaza un encabezado duplicado"; "AC-12: mapHeaders_ rechaza un duplicado normalizado (First Name / first  name)"; "AC-12: mapHeaders_ rechaza la falta de Email Address"; "AC-12: mapHeaders_ rechaza la falta de Mail Merge Status"; "AC-12: mapHeaders_ rechaza un encabezado requerido con otra capitalización (email address)"; "AC-12: mapHeaders_ rechaza un encabezado requerido con otro espaciado interno"; "AC-12: mapHeaders_ acepta encabezados con espacios alrededor y celdas vacías"; "AC-12: mapHeaders_ sin Scheduled Date ni File Attachments marca esas columnas como ausentes (-1)"; `tests/preflight.test.js`: "AC-12: un encabezado duplicado es error global" | — |
| AC-13 | Destinatario inválido: fila bloqueada antes de Gmail | `PASS (local mock)` | `tests/sheet.test.js`: "AC-13: isValidEmail_ acepta una dirección simple"; "AC-13: isValidEmail_ rechaza direcciones inválidas o múltiples"; `tests/preflight.test.js`: "AC-13: un destinatario inválido o vacío invalida solo esa fila"; `tests/send.test.js`: "AC-07 / AC-13: filas inválidas en la validación nunca llegan a Gmail en el envío real" | — |
| AC-14 | Alias no autorizado: validación y confirmación bloqueadas, sin envío | `PASS (local mock)` | `tests/preflight.test.js`: "AC-14: un remitente fuera de la cuenta y sus alias es error global"; `tests/test-send.test.js`: "AC-14: con errores globales la prueba no envía"; `tests/ui.test.js`: "AC-14: runSendPending_ con errores globales solo muestra el informe, sin confirm"; `tests/services.test.js`: "D-05 / AC-14: gmail.send pasa from (alias) y replyTo cuando corresponden" | 4 |
| AC-15 | Prueba: mismo mensaje y adjuntos que el real; solo cambian destinatario y prefijo `[PRUEBA] ` | `PASS (local mock)` | `tests/test-send.test.js`: "AC-15: runTestSend_ envía una vez el mismo mensaje del envío real, salvo destinatario y prefijo"; `tests/ui.test.js`: "AC-15: runTestSendFromUi_ con fila 2 envía una prueba y muestra el resultado" | 6 |
| AC-16 | Prueba con un adjunto faltante: falla cerrado, estado sin cambios, sin llamada a Gmail | `PASS (local mock)` | `tests/test-send.test.js`: "AC-16: una prueba con un adjunto faltante falla cerrado sin enviar ni cambiar estado"; "AC-16: una falla de Drive al exportar el adjunto bloquea la prueba"; `tests/ui.test.js`: "AC-16: runTestSendFromUi_ con una fila inválida muestra los errores sin enviar" | — |
| AC-17 | Sin confirmación explícita: sin envío | `PASS (local mock)` | `tests/ui.test.js`: "AC-17: runSendPending_ con confirm falso no envía ni escribe estado"; "AC-17 / D-23: el texto de confirm tiene la advertencia, la cantidad de filas y la revisión por fila"; "AC-17: runSendPending_ con confirm verdadero envía y muestra formatSendSummary_" | 2 |
| AC-18 | Dos ejecuciones simultáneas: un solo dueño del lock, un envío por fila como máximo | `PASS (local mock)` | `tests/send.test.js`: "AC-18: sin lock no envía ni escribe y lo informa"; "AC-18: dos ejecuciones confirmadas a la vez envían un solo correo por fila"; `tests/services.test.js`: "AC-18: lock usa getDocumentLock con tryLock y release llama a releaseLock" | 2 |
| AC-19 | Corte después del checkpoint `ENVIANDO` y antes de Gmail: revisión manual, sin reintento automático | `PASS (local mock)` | `tests/send.test.js`: "AC-19: claim persistido y falla posterior → cero envíos, ejecución detenida, la fila queda ENVIANDO"; "AC-19: claim que falla sin escribir → cero envíos, ejecución detenida, la fila sigue vacía" | — |
| AC-20 | Corte después de que Gmail aceptó y antes de persistir el éxito: estado ambiguo retenido, sin reintento | `PASS (local mock)` | `tests/send.test.js`: "AC-20: falla al persistir Email Sent → un envío, la fila queda ENVIANDO y no se reenvía" | — |
| AC-21 | Excepción de Gmail con resultado incierto: revisión manual | `PASS (local mock)` | `tests/send.test.js`: "AC-21: Gmail lanza → la fila queda REVISAR, la ejecución se detiene y las siguientes no se tocan" | — |
| AC-22 | Cerca del límite de tiempo o cuota: corte limpio, filas no reclamadas siguen elegibles | `PASS (local mock)` | `tests/send.test.js`: "AC-22: con el reloj por encima de MAX_RUNTIME_MS no envía y deja las filas elegibles"; "AC-22: con cuota 1 y tres filas envía una sola y las demás siguen vacías y elegibles"; "AC-22: con cuota 0 al iniciar la Fase B no envía nada y lo informa" | 5, 9 |
| AC-23 | Destinatario o enlace editado después de la validación: la fila se revalida y no se envía sin aviso | `PASS (local mock)` | `tests/send.test.js`: "AC-23: el destinatario editado entre fases se omite y las demás filas se envían"; "AC-23: el enlace de adjunto editado entre fases se omite y las demás filas se envían"; "AC-23: una edición durante el recorrido (beforeReadRow) omite esa fila" | — |
| AC-24 | Cambio de pestaña activa o filas reordenadas: identidad estable, nunca se envía con datos de otra fila | `PASS (local mock)` | `tests/send.test.js`: "AC-24: filas intercambiadas entre fases nunca se envían con datos de otra fila"; "Fase B paso 8: una fila insertada arriba durante el envío no recibe Email Sent". La pestaña se elige por `sheetId` en la configuración, nunca por la pestaña activa (`tests/ui.test.js`: "Sidebar: saveConfig guarda sheetId numérico a partir del texto del select") | — |
| AC-25 | Re-ejecución después de un éxito: cero duplicados | `PASS (local mock)` | `tests/send.test.js`: "AC-25: una re-ejecución después de un envío exitoso no duplica" | — |
| AC-26 | Registro después de un envío: fecha, referencia y resultado; sin cuerpo, URLs ni volcado de la fila | `PASS (local mock)` | `tests/send.test.js`: "AC-26: las entradas de registro de un envío exitoso solo tienen los campos permitidos"; `tests/services.test.js`: "AC-26: appendLog neutraliza textos que Sheets interpretaría como fórmula" | — |
| AC-27 | Solo validación: cero envíos, cero escrituras de estado | `PASS (local mock)` | `tests/preflight.test.js`: "AC-27: buildPreflight_ es de solo lectura y devuelve las filas elegibles"; `tests/ui.test.js`: "AC-27: runValidate_ muestra un alert y no envía, no escribe estado ni registro"; "D-23 (AC-27): el alert de Validar incluye la revisión por fila" | — |
| AC-28 | Manifest y scopes: solo scopes justificados, sin servicios ni credenciales ajenos | `PASS (local mock)` | `tests/manifest.test.js`: "AC-28: el manifest usa el runtime V8"; "AC-28: oauthScopes es exactamente la lista aprobada"; "AC-28: el manifest no declara webapp, executionApi ni dependencies"; "AC-28: ningún archivo de src usa UrlFetchApp, ScriptApp.newTrigger ni setSharing"; "D-01 (AC-28): constantes literales de compatibilidad". Revisión manual de `src/appsscript.json`: ver abajo | 1, 3, 11, 12 |
| AC-29 | Repositorio Git local sin remoto, commits trazables, sin secretos | `PASS (local mock)` | Comandos locales: ver "Evidencia de AC-29" | — |
| AC-30 | Tests offline sin autenticación de Google, IDs reales ni red | `PASS (local mock)` | Comando `node --test`: ver "Resultado de la suite" y "Evidencia de AC-30" | — |
| AC-31 | (D-03) Fila con `Scheduled Date` con valor: excluida y contada | `PASS (local mock)` | `tests/sheet.test.js`: "D-03 (AC-31): una fila con Scheduled Date con valor queda excluida"; "D-03 (AC-31): sin columna Scheduled Date la fila es elegible" | — |

**Resumen:** 31 de 31 criterios `PASS (local mock)`, 0 `FAIL`. Ninguno está verificado en vivo.

## Cobertura adicional de decisiones del plan

Tests que cubren decisiones `D-xx` y requisitos `R-xx` sin un AC propio:

| Decisión | Tests (archivo) |
|---|---|
| D-05 (`from` y Reply-To solo cuando corresponden) | `tests/services.test.js` |
| D-07 (prueba: fila fuera de rango o vacía, fila no elegible) | `tests/test-send.test.js`, `tests/ui.test.js` |
| D-08 (configuración por usuario, `sheetId` numérico) | `tests/services.test.js` |
| D-13 (`Email Sent` = aceptado por Gmail, nunca "entregado") | `tests/send.test.js` |
| D-14 (clave de fila) | `tests/sheet.test.js` |
| D-15 (cambio de plantilla o error global entre fases: cancelación total) | `tests/preflight.test.js`, `tests/send.test.js` |
| D-17 (pestaña de registro) | `tests/services.test.js` |
| D-18 (falla del registro no detiene el envío) | `tests/send.test.js`, `tests/test-send.test.js` |
| D-21 (tamaño del cuerpo, bytes UTF-8) | `tests/template.test.js`, `tests/preflight.test.js` |
| D-22 (cuenta sin dirección identificable) | `tests/preflight.test.js`, `tests/test-send.test.js` |
| D-23 (revisión por fila antes de confirmar) | `tests/preflight.test.js`, `tests/ui.test.js` |
| R-02 / R-04 (validación de la sidebar al guardar) | `tests/ui.test.js` |
| R-03 (marcadores codificados como entidad, `$&`, marcadores no resueltos, imágenes inline) | `tests/template.test.js` |
| R-05 (formatos de enlace de Drive) | `tests/attachments.test.js` |
| R-12 (`writeStatus` escribe en la columna correcta y hace `flush`) | `tests/services.test.js` |

Algunos tests no llevan ID porque el plan no les asigna uno (por ejemplo `onOpen`, `menuShowLog`, `listSheets`, `createUi_`, `formatPreflightReport_` y el camino feliz del envío); cubren el contrato de los adaptadores y de la interfaz descripto en el plan.

## Evidencia de AC-29

`git remote -v` (salida vacía: no hay remotos):

```text
```

`git status --short` al cerrar la verificación, antes del commit de este paso (solo los archivos del paso 6; ningún archivo inesperado):

```text
 M README.md
 M tests/send.test.js
?? docs/ACCEPTANCE_STATUS.md
?? docs/OPERATIONS.md
```

Commits locales trazables (`git log --oneline`), uno por paso del plan:

```text
3c3eff9 feat(ui): agregar adaptadores de Google, menú, diálogos y sidebar
7878c0d feat(send): agregar envío en dos fases con lock y checkpoint por fila
0c75370 feat(preflight): agregar validación previa, armado de mensaje y envío de prueba
a5cc08b feat(template): agregar plantillas y enlaces de adjuntos de Drive
02da9b4 feat(sheet): agregar manifest, constantes, lógica de hoja y cargador vm
4d8540e docs(plans): agregar plan de Mail Merge V1
6399b4a chore: configurar el proyecto para trabajo local en español
4789e07 chore: importar documentación inicial del proyecto
```

Sin secretos versionados: `git ls-files | grep -iE "\.env|clasp|credential|token|\.pem|\.key"` no devuelve nada; `.gitignore` excluye `.clasp.json`, `.clasprc.json`, `credentials.json`, `token.json`, `.env*`, `*.pem` y `*.key`. Los datos de prueba son sintéticos (`example.test`, IDs de Drive inventados).

## Evidencia de AC-30

- Comando: `node --test` con Node portable v20.11.1, sin `npm install`, sin `package.json` ni dependencias. Resultado: 153 tests, 153 pass, 0 fail.
- Los tests solo cargan módulos del propio Node (`node:test`, `node:assert/strict`, `node:vm`, `node:fs`, `node:path`) y los helpers locales; ningún archivo de `tests/` ni de `src/` usa `http`, `https`, `net`, `fetch` ni `UrlFetchApp`.
- Los servicios de Google (`SpreadsheetApp`, `GmailApp`, `DriveApp`, `LockService`, `MailApp`, `PropertiesService`, `Session`, `Utilities`, `HtmlService`) se reemplazan por falsos; no hay credenciales, tokens ni IDs reales de archivos.
- Sintaxis: `node --check` sin errores sobre los 20 archivos `src/*.js`, `tests/*.js`, `tests/helpers/*.js` y `tests/fixtures/*.js`; `src/appsscript.json` es JSON válido; `git diff --check` sin salida.

## Revisión manual de `src/appsscript.json`

| Campo | Valor | Justificación (plan, "Scopes") |
|---|---|---|
| `runtimeVersion` | `V8` | Runtime requerido |
| `timeZone` | `Etc/UTC` | D-20. Aceptación por Apps Script sin confirmar: `PENDING LIVE VALIDATION` (ítem 11) |
| `spreadsheets.currentonly` | presente | Leer y escribir solo el Sheet vinculado |
| `script.container.ui` | presente | Menú, diálogos y sidebar |
| `https://mail.google.com/` | presente | `GmailApp`: borradores, alias y envío. Scope amplio (D-24) |
| `drive.readonly` | presente | Leer y exportar adjuntos; nunca cambiar permisos. Scope amplio (D-24) |
| `script.send_mail` | presente | `MailApp.getRemainingDailyQuota()` |
| `userinfo.email` | presente | `Session.getEffectiveUser().getEmail()` |
| `webapp`, `executionApi`, `dependencies` | ausentes | Sin web app, sin API de ejecución, sin bibliotecas |
| `script.external_request`, triggers | ausentes | Sin `UrlFetchApp` ni triggers instalables |

Los seis scopes coinciden exactamente con la lista aprobada del plan.

## Verificaciones en vivo pendientes

Todas `PENDING LIVE VALIDATION`. El detalle y los pasos de activación (descriptos, no ejecutados) están en [`OPERATIONS.md`](OPERATIONS.md#checklist-pending-live-validation).

1. **Autorización explícita de los scopes amplios `https://mail.google.com/` y `drive.readonly` (D-24)**: riesgo aceptado solo para el desarrollo local; requiere revisar la pantalla de consentimiento y la política de Workspace, y la autorización del responsable antes de cualquier uso real.
2. Comportamiento real de `Ui.alert` y `LockService` en el runtime.
3. Scopes efectivos y pantalla de consentimiento.
4. Alias y Reply-To reales.
5. Cuota diaria real de la cuenta.
6. Aspecto del HTML, imágenes inline y firma en una casilla de prueba.
7. Exportación a PDF de archivos nativos y tamaños reales.
8. Detección de filas ocultas por filtro y a mano.
9. Tiempos reales por fila frente a `MAX_RUNTIME_MS`, incluido el costo de leer filas ocultas en hojas grandes.
10. Formatos reales de enlaces de Drive de los operadores frente a los aceptados (D-09).
11. OPEN: que Apps Script acepte `"timeZone": "Etc/UTC"`.
12. OPEN: scopes más acotados que `https://mail.google.com/`.
