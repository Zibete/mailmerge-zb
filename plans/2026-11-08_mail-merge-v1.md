# Plan — Mail Merge V1 local (Apps Script V8)

**Estado:** plan canónico de `spec-driven-dev`. Insumos: `docs/PRODUCT.md`, `docs/REQUIREMENTS_DRAFT.md` (R-01 a R-15), `docs/ACCEPTANCE.md` (AC-01 a AC-30), `docs/DECISIONS.md`, `docs/REFERENCE_AUDIT.md`. Se conservan los IDs `R-xx` y `AC-xx` para trazabilidad. Meta: `LOCAL_VERIFIED`; todo lo que dependa de Google queda `PENDING LIVE VALIDATION`.

## Contexto

Un equipo usa un complemento pago de mail merge para enviar avisos operativos individuales desde un Google Sheet, con plantilla de Gmail, variables por fila y adjuntos de Drive por fila. Se busca un reemplazo chico, mantenible y seguro: un único proyecto de Apps Script vinculado al Sheet, sin backend ni dependencias, que preserve las columnas y estados que los operadores ya conocen y que nunca envíe un mail incompleto ni duplique un envío por reintento automático.

Todo se desarrolla y prueba localmente con Node.js portable v20.11.1 (`node --test`, sin dependencias) y adaptadores falsos. No hay `clasp`, OAuth, despliegue ni envíos reales.

## Enfoque

1. **Núcleo puro y adaptadores finos.** La lógica determinista (encabezados, elegibilidad, plantillas, enlaces de Drive, validación previa, motor de envío) recibe datos planos y un objeto `deps` con los servicios. En producción `createServices_()` construye `deps` sobre `SpreadsheetApp`, `GmailApp`, `DriveApp`, `LockService`, `MailApp` y `PropertiesService`; en los tests se inyectan falsos que registran llamadas.
2. **Código Apps Script puro, sin módulos.** Los archivos de `src/` son scripts globales como los ejecuta Apps Script (sin `module.exports`, sin `require`, sin bundler). Los tests los cargan todos en un único contexto `vm` de Node, que reproduce el espacio global compartido de Apps Script. Ningún archivo ejecuta código de nivel superior que dependa de otro archivo: solo declaraciones de funciones y constantes.
3. **Confirmación fuera del lock, envío dentro del lock.** `Ui.alert()` suspende la ejecución hasta que el operador responde y no se asume que un lock de `LockService` se conserve durante esa espera. Por eso el envío tiene dos fases dentro de la misma ejecución: **Fase A** (sin lock) valida, arma el resumen y pide la confirmación; **Fase B** (después del "Sí") toma el lock, relee todo desde cero, compara contra lo confirmado y solo envía filas idénticas a las confirmadas. Lo confirmado vive en memoria de la propia ejecución: no se persiste ningún snapshot ni digest.
4. **Checkpoint por fila.** Dentro del lock, para cada fila: releer la fila, comparar, armar el mensaje completo (adjuntos incluidos), persistir `ENVIANDO` con `flush`, llamar a Gmail, persistir `Email Sent` con `flush`. Cualquier falla después del claim deja la fila fuera de los envíos automáticos (`ENVIANDO` o `REVISAR`) hasta una revisión manual.
5. **Interfaz mínima.** Menú `Mail Merge` con cinco ítems y una sidebar solo para configurar la campaña (pestaña, borrador, remitente, Reply-To), que es lo que no se puede elegir con un diálogo simple. Validación, prueba, confirmación y resumen usan `Ui.alert` / `Ui.prompt`.

## Decisiones de implementación

Cada decisión no bloqueante se resolvió con el default más conservador; las marcadas `ASSUMPTION` no tienen evidencia de uso real y se revisan en la validación en vivo.

| ID | Decisión | Motivo |
|---|---|---|
| D-01 | Valores literales: encabezados `Email Address`, `File Attachments`, `Mail Merge Status`, `Scheduled Date`; estados heredados `SKIP`, `Email Sent`; estados nuevos `ENVIANDO`, `REVISAR`; prefijo de prueba `[PRUEBA] ` | Aprobado por el usuario (ver `CLAUDE.md`) |
| D-02 | Fila de encabezados fija en la fila 1; no configurable | R-01 favorece la fila 1; evita mapeos frágiles |
| D-03 | Solo es elegible una fila visible con `Mail Merge Status` vacío y `Scheduled Date` vacío (si la columna existe) | R-06 y DECISIONS.md pregunta 2. `ASSUMPTION`: una fila con fecha programada se excluye y se reporta, nunca se envía antes de tiempo |
| D-04 | Un marcador referenciado debe resolverse a un valor no vacío; marcador desconocido o vacío bloquea la fila | R-03, DECISIONS.md pregunta 4 |
| D-05 | Sin CC/BCC; un destinatario por fila; remitente = cuenta que ejecuta o un alias de `GmailApp.getAliases()`; Reply-To opcional | R-04, DECISIONS.md pregunta 3 |
| D-06 | Casilla de prueba = correo de la cuenta que ejecuta (`Session.getEffectiveUser().getEmail()`); no editable | R-08 pide una casilla aprobada; la propia cuenta es la única aprobada sin configuración extra. `ASSUMPTION` |
| D-07 | La prueba exige una fila válida (encabezados, marcadores, destinatario, adjuntos) pero ignora estado y visibilidad; nunca escribe estado | Permite probar con cualquier fila sin tocar el estado de la campaña (R-08) |
| D-08 | Configuración de campaña en `PropertiesService.getUserProperties()` (por usuario) | El borrador y los alias pertenecen al buzón de cada usuario; con propiedades del documento otro usuario heredaría un ID de borrador ajeno |
| D-09 | Enlaces aceptados en `File Attachments`: solo URLs `https://` de `drive.google.com` o `docs.google.com` con un ID extraíble; separador coma; se ignoran espacios y piezas vacías; un ID repetido en la misma fila bloquea la fila | Compatibilidad con el complemento (enlaces separados por comas) y validación estricta (R-05). Un ID suelto no es un enlace y se rechaza |
| D-10 | Archivos nativos de Documentos, Hojas de cálculo y Presentaciones se exportan a PDF con `getAs('application/pdf')`; otros tipos nativos (formularios, dibujos, accesos directos, carpetas) bloquean la fila; archivos binarios usan `getBlob()` sin conversión | R-05; el complemento documenta exportación a PDF |
| D-11 | Límites configurables en `Config.js`: tamaño máximo total de adjuntos por mensaje, presupuesto de tiempo de ejecución y espera del lock | Nunca hardcodear límites de cuenta en la lógica (DECISIONS.md pregunta 5) |
| D-12 | El presupuesto de tiempo se mide desde el **inicio de la ejecución** (antes del diálogo), no desde la confirmación | Conservador: el tiempo que el operador tarda en responder puede contar contra el límite de ejecución |
| D-13 | `Email Sent` significa "aceptado por la API de Gmail", nunca "entregado"; así se documenta en la guía | R-13 |
| D-14 | La identidad estable de una fila es `(sheetId, número de fila, clave de fila)`, donde la clave es el JSON de todos los valores mostrados de la fila. No se agregan columnas de ID | R-10 y AC-24 sin modificar la estructura del Sheet del operador |
| D-15 | Si cambian la plantilla, los encabezados, el remitente o el Reply-To entre la Fase A y la Fase B, se cancela todo el envío sin enviar nada. Si cambia una fila, solo esa fila se omite y se reporta | Cambios globales invalidan la confirmación completa; cambios locales solo la fila afectada (R-07) |
| D-16 | Ante una excepción ambigua de Gmail se marca `REVISAR` (si se puede escribir) y se **detiene** la ejecución | Una falla del servicio probablemente afecta a las filas siguientes; no hay reintento automático (R-11) |
| D-17 | El registro es una pestaña `Registro Mail Merge` del mismo Sheet, creada al primer uso, con columnas `Fecha`, `Campaña`, `Pestaña`, `Fila`, `Destinatario`, `Resultado`, `Detalle`. La validación nunca escribe en el registro | R-13 y AC-27 |
| D-18 | Una falla al escribir el registro no cambia el estado de la fila ni detiene el envío; se informa en el resumen final | El estado en la hoja es la fuente de verdad del control de duplicados |
| D-19 | Errores de validación no escriben estado; solo se reportan | R-06/R-11: una validación fallida no debe bloquear la corrección |
| D-20 | La zona horaria del manifest es `Etc/UTC`; las fechas del registro se escriben como `Date` y la hoja las muestra en su propia zona horaria | No depender de la zona del script |
| D-21 | Límite configurable `LIMITS.MAX_BODY_BYTES` (200 KB, el menor de la página de cuotas: cuentas de consumo) sobre la suma en bytes UTF-8 del HTML y el texto plano renderizados; si se supera, la fila queda inválida en la validación previa y en `buildMessage_`, antes del claim | Due diligence: el límite de cuerpo existe y, sin control previo, `sendEmail` fallaría después del claim, dejaría `REVISAR` y cortaría toda la ejecución (D-16) |
| D-22 | Si `session.userEmail()` devuelve vacío, la validación previa reporta un error global (`No se pudo identificar la cuenta que ejecuta`) y la prueba no envía | Due diligence: `Session.getEmail()` puede devolver `''`; falla cerrado con un mensaje claro en lugar de un error de Gmail |
| D-23 | El informe de `Validar` y la confirmación de `Enviar pendientes…` listan, para las filas que se enviarían, `Fila N → destinatario: archivo1, archivo2` (nombres de Drive, nunca URLs), hasta 20 filas y luego `y N filas más`; además muestran una vez los nombres de los adjuntos comunes del borrador | Aprobado por el usuario (due diligence, punto 1): el operador ve qué archivo va a qué dirección antes de confirmar, porque cualquier editor del Sheet puede cambiar destinatarios y enlaces |
| D-24 | Los scopes `https://mail.google.com/` y `drive.readonly` son amplios (restringidos por Google). Se aceptan como riesgo técnico **solo para el desarrollo local**; antes de cualquier uso real requieren autorización explícita (revisión de la pantalla de consentimiento y de la política de Workspace) y validación en vivo. No se exploran scopes REST más acotados en V1 | Aprobado por el usuario (due diligence, punto 4): es la combinación mínima documentada para `GmailApp` y `DriveApp`; una alternativa no verificada podría fallar recién en el runtime |

## Archivos

Proyecto Apps Script en `src/` (futuro `rootDir` de `clasp`, que no se usa ahora). Nombres de archivos e identificadores en inglés; textos de interfaz, mensajes y comentarios en español. Las funciones con sufijo `_` son privadas en Apps Script; solo los manejadores de menú, `onOpen` y las funciones que llama la sidebar son públicas.

| Archivo | Contenido |
|---|---|
| `src/appsscript.json` | Manifest: `timeZone: "Etc/UTC"`, `runtimeVersion: "V8"`, `oauthScopes` explícitos (ver "Scopes"). Sin `dependencies`, sin `webapp`, sin `executionApi` |
| `src/Config.js` | Constantes: `HEADERS`, `STATUS`, `TEST_SUBJECT_PREFIX`, `LIMITS` (`MAX_TOTAL_ATTACHMENT_BYTES`, `MAX_BODY_BYTES`, `MAX_RUNTIME_MS`, `LOCK_WAIT_MS`), `LOG_SHEET_NAME`, `LOG_HEADERS`, `PROPERTY_KEYS`, `GOOGLE_EXPORTABLE_MIME_TYPES` |
| `src/Sheet.js` | `mapHeaders_`, `classifyRows_`, `isValidEmail_`, `rowKey_` |
| `src/Template.js` | `escapeHtml_`, `sanitizeHeaderValue_`, `extractTokens_`, `renderTemplate_`, `findUnresolvedTokens_`, `mapInlineImages_`, `utf8ByteLength_` |
| `src/Attachments.js` | `parseDriveLinks_`, `classifyDriveFile_`, `checkAttachmentSizes_` |
| `src/Preflight.js` | `buildPreflight_`, `formatRowReview_`, `formatPreflightReport_` |
| `src/Send.js` | `buildMessage_`, `runTestSend_`, `prepareSend_`, `executeSend_`, `formatSendSummary_`, `appendLogSafe_` |
| `src/Services.js` | `createServices_` (adaptadores Google). Sin lógica de negocio |
| `src/Ui.js` | `onOpen`, `menuConfigure`, `menuValidate`, `menuTestSend`, `menuSendPending`, `menuShowLog`, `getConfigOptions`, `saveConfig`, controladores `runValidate_`, `runTestSendFromUi_`, `runSendPending_`, `createUi_` |
| `src/Sidebar.html` | Formulario de configuración |
| `tests/helpers/load-apps-script.js` | Cargador `vm` de todos los `src/*.js` |
| `tests/helpers/fakes.js` | Servicios falsos con registro de llamadas e inyección de fallas |
| `tests/fixtures/campaign.js` | Fixture sintético de `docs/ACCEPTANCE.md` |
| `tests/*.test.js` | Tests unitarios y de integración con falsos |
| `docs/OPERATIONS.md` | Guía de uso, reconciliación manual y checklist de despliegue futuro |
| `docs/ACCEPTANCE_STATUS.md` | Reporte de aceptación por AC |
| `README.md` | Solo agregar enlaces a las dos guías nuevas |

## Detalle del código

### `Config.js`

```js
const HEADERS = { EMAIL: 'Email Address', ATTACHMENTS: 'File Attachments', STATUS: 'Mail Merge Status', SCHEDULED: 'Scheduled Date' };
const STATUS = { SKIP: 'SKIP', SENT: 'Email Sent', SENDING: 'ENVIANDO', REVIEW: 'REVISAR' };
const TEST_SUBJECT_PREFIX = '[PRUEBA] ';
const LIMITS = { MAX_TOTAL_ATTACHMENT_BYTES: 20 * 1024 * 1024, MAX_BODY_BYTES: 200 * 1024, MAX_RUNTIME_MS: 270000, LOCK_WAIT_MS: 10000 };
const LOG_SHEET_NAME = 'Registro Mail Merge';
const LOG_HEADERS = ['Fecha', 'Campaña', 'Pestaña', 'Fila', 'Destinatario', 'Resultado', 'Detalle'];
const PROPERTY_KEYS = { SHEET_ID: 'MM_SHEET_ID', DRAFT_ID: 'MM_DRAFT_ID', FROM: 'MM_FROM', REPLY_TO: 'MM_REPLY_TO' };
const GOOGLE_EXPORTABLE_MIME_TYPES = ['application/vnd.google-apps.document', 'application/vnd.google-apps.spreadsheet', 'application/vnd.google-apps.presentation'];
```

Las constantes de nivel superior (`const`) son visibles desde los demás archivos en tiempo de ejecución (Apps Script y el contexto `vm` comparten el entorno léxico global), pero ningún archivo las usa en su nivel superior: el orden de carga no importa.

`MAX_TOTAL_ATTACHMENT_BYTES` (20 MB) queda por debajo del límite de 25 MB de Gmail para dejar margen al encoding; `MAX_RUNTIME_MS` (4,5 min) queda por debajo del límite de 6 min por ejecución. Ambos límites (25 MB de adjuntos totales por mensaje, 6 min por ejecución) se verificaron en la due diligence contra la página de cuotas de Apps Script. `MAX_BODY_BYTES` (200 KB) es el límite de cuerpo por mensaje más bajo de esa página (cuentas de consumo; Workspace admite 400 KB), ver D-21.

### Contrato de `deps` (lo que `createServices_()` devuelve y los falsos imitan)

```js
deps = {
  sheets: {
    listSheets(),                         // [{ id, name }]
    readSheet(sheetId),                   // { id, name, values: string[][] (getDisplayValues de getDataRange, fila 1 = encabezados), hiddenByUser: bool[], hiddenByFilter: bool[] } | lanza si no existe. hiddenBy*[i] corresponde a values[i] (índice 0 = encabezado, siempre false)
    readRow(sheetId, rowNumber, width),   // string[] (display values)
    writeStatus(sheetId, rowNumber, column, value), // column = índice 0-based de mapHeaders_; el adaptador usa getRange(rowNumber, column + 1).setValue(value) + SpreadsheetApp.flush()
    appendLog(entry),                     // crea la pestaña de registro con LOG_HEADERS si falta; appendRow
    showLogSheet(),                       // activa la pestaña de registro; devuelve false si no existe
  },
  gmail: {
    listDrafts(),                         // [{ id, subject, date }] con date como texto ISO: google.script.run no transporta objetos Date hacia la sidebar
    getTemplate(draftId),                 // { id, subject, plainBody, htmlBody, attachments: [{ name, size, mimeType, blob }], inlineImages: [{ name, blob }] } | lanza. GmailAttachment no expone el Content-ID: las imágenes inline se leen con getAttachments({ includeInlineImages: true, includeAttachments: false }) y los comunes con includeInlineImages: false
    getAliases(),                         // string[]
    send(message),                        // GmailApp.sendEmail(to, subject, plainBody, { htmlBody, attachments, inlineImages, from, replyTo }); omite replyTo si es '' y omite from si es la cuenta propia (from debe ser uno de getAliases(); PENDING LIVE VALIDATION)
  },
  drive: {
    getFileInfo(fileId),                  // { id, name, mimeType, size, trashed } | lanza si no existe o no hay acceso
    getAttachment(fileInfo),              // { name, size, mimeType, blob }; nativo → getAs('application/pdf') con nombre `${name}.pdf`
  },
  lock: { tryLock(ms), release() },       // LockService.getDocumentLock(); el adaptador llama a Lock.tryLock(ms) y Lock.releaseLock() (Lock no tiene release())
  quota: { remaining() },                 // MailApp.getRemainingDailyQuota()
  session: { userEmail() },               // Session.getEffectiveUser().getEmail()
  props: { getConfig(), setConfig(config) }, // UserProperties
  clock: { now() },                       // Date.now()
  ids: { newCampaignId() },               // Utilities.getUuid().slice(0, 8)
}
```

`config = { sheetId: number, draftId: string, from: string, replyTo: string }` (`replyTo` puede ser `''`). `UserProperties` guarda texto: `props.getConfig()` convierte `sheetId` a `Number` (o `null` si falta) para que la comparación estricta con `getSheetId()` funcione.

### `Sheet.js`

- `mapHeaders_(headerRow)` → `{ ok, columns: { email, attachments, status, scheduled }, byName: { [header]: index }, errors: string[] }`. Recorta espacios. Error si `Email Address` o `Mail Merge Status` faltan, si cualquier encabezado aparece dos veces comparando en forma normalizada (recorte, espacios colapsados, minúsculas), o si un encabezado requerido aparece con otra capitalización o espaciado (por ejemplo `email address`) — se reporta como encabezado ambiguo en lugar de adivinar (AC-12). Encabezados vacíos se ignoran.
- `classifyRows_(sheetData, columns)` → `{ eligible: [{ rowNumber, values }], excluded: [{ rowNumber, reason }], blankRows: number }`. `rowNumber` es 1-based (la fila 2 es el primer dato). Una fila con todas las celdas vacías no cuenta. Motivos de exclusión, en este orden: `oculta por el usuario`, `oculta por un filtro`, `estado: <valor>` (cualquier estado no vacío, incluidos `SKIP`, `Email Sent`, `ENVIANDO`, `REVISAR`, fechas o texto arbitrario), `Scheduled Date con valor`.
- `isValidEmail_(value)` → bool. Una sola dirección; sin espacios, comas, punto y coma, `<`, `>`, comillas ni CR/LF; patrón `^[^\s@<>(),;:"]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$`; largo máximo 254.
- `rowKey_(values)` → `JSON.stringify(values)`.

### `Template.js`

- `escapeHtml_(s)` reemplaza `&`, `<`, `>`, `"`, `'`.
- `sanitizeHeaderValue_(s)` reemplaza cualquier secuencia de CR/LF/tab por un espacio y recorta.
- `extractTokens_(text, { html })` → nombres de marcador únicos según `/{{\s*([^{}]+?)\s*}}/g`. Con `html: true`, el nombre se decodifica de las entidades `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;` y `&nbsp;` (este último y el carácter U+00A0 se convierten en un espacio común) antes de compararlo con los encabezados (Gmail codifica `R&D` como `R&amp;D` en el HTML).
- `renderTemplate_(template, rowValuesByHeader)` → `{ ok, subject, plainBody, htmlBody, errors }`. Une los marcadores de asunto, texto y HTML. Error por cada marcador que no es un encabezado (`Marcador desconocido: {{X}}`, AC-03) o cuyo valor recortado es vacío (`El campo "X" está vacío`, AC-04). Si no hay errores: asunto con `sanitizeHeaderValue_`, texto plano con el valor crudo, HTML con `escapeHtml_`. La sustitución usa una función de reemplazo (nunca construye un `RegExp` con el nombre de la columna y nunca interpreta `$` del valor).
- `findUnresolvedTokens_(text)` → `true` si después de renderizar quedan `{{` o `}}`; bloquea la fila (cubre marcadores cortados por etiquetas HTML, por ejemplo `{{First <b>Name</b>}}`).
- `mapInlineImages_(htmlBody, inlineImages)` → `{ ok, inlineImages: { [cid]: blob }, errors }`. Cada `src="cid:X"` del HTML debe corresponder a una imagen inline del borrador; si alguna no se puede emparejar, la plantilla es inválida (falla cerrado). Como `GmailAttachment` no expone el Content-ID, el emparejamiento es por el atributo `alt` del `<img>` contra el nombre de la imagen inline (`getName()`), como en la muestra oficial de Google; la clave del objeto resultante es el `cid` del HTML. Un `<img src="cid:…">` sin `alt` o con un `alt` que no coincide con ningún nombre es error. El comportamiento real de Gmail queda `PENDING LIVE VALIDATION`.
- `utf8ByteLength_(s)` → cantidad de bytes UTF-8 del texto, calculada en JavaScript puro (sin `Utilities` ni `Buffer`, para que funcione igual en Apps Script y en Node). La usan la validación previa y `buildMessage_` para controlar `htmlBody` + `plainBody` contra `LIMITS.MAX_BODY_BYTES` (D-21); al superarlo, la fila es inválida con `El cuerpo del correo supera el tamaño máximo permitido`.

### `Attachments.js`

- `parseDriveLinks_(cell)` → `{ ids: string[], errors: string[] }`. Divide por comas, recorta, ignora piezas vacías. Formatos aceptados: `https://drive.google.com/file/d/<ID>/...`, `https://drive.google.com/open?id=<ID>`, `https://drive.google.com/uc?id=<ID>...`, `https://docs.google.com/(document|spreadsheets|presentation)/d/<ID>/...`. ID: `[A-Za-z0-9_-]{20,}`. Cualquier otro host, protocolo o forma es error (`Enlace de adjunto n.º N no válido`). ID repetido en la misma celda es error. Los mensajes de error nunca incluyen la URL (R-13).
- `classifyDriveFile_(info)` → `{ ok, kind: 'binary' | 'export-pdf', error }`. `trashed` → error; `GOOGLE_EXPORTABLE_MIME_TYPES` (`application/vnd.google-apps.document`, `.spreadsheet`, `.presentation`) → `export-pdf`; cualquier otro `application/vnd.google-apps.*` → error `tipo no soportado`; resto → `binary`.
- `checkAttachmentSizes_(attachments, maxBytes)` → `{ ok, totalBytes, error }`, sobre adjuntos comunes + de la fila (AC-09).

### `Preflight.js`

- `buildPreflight_(deps, config)` → informe de solo lectura (R-07, AC-27): nunca llama a `gmail.send`, `writeStatus` ni `appendLog`. Pasos: validar que `config` esté completo; `readSheet`; `mapHeaders_`; `getTemplate`; validar plantilla (`extractTokens_` sobre el conjunto de encabezados, `mapInlineImages_`); validar que `session.userEmail()` no sea vacío (si lo es, error global, D-22) y `from` contra `session.userEmail()` + `getAliases()` (AC-14) y `replyTo` con `isValidEmail_` si no está vacío; `classifyRows_`; para cada fila elegible: `isValidEmail_` (AC-13), `renderTemplate_` + `findUnresolvedTokens_`, tamaño del cuerpo con `utf8ByteLength_` (D-21), `parseDriveLinks_`, `getFileInfo` + `classifyDriveFile_` por adjunto (AC-07), y tamaño con `checkAttachmentSizes_` usando `size` de binarios y adjuntos comunes; `quota.remaining()`.
- Resultado: `{ ok, globalErrors: string[], sheet: { id, name }, template: { id, subject }, templateData, from, replyTo, headers, templateKey, valid: [{ rowNumber, values, key, email, attachmentNames }], invalid: [{ rowNumber, reasons }], excluded: [{ rowNumber, reason }], quotaRemaining }`. `headers` es el resultado completo de `mapHeaders_` (`columns` y `byName`), que `buildMessage_` y `writeStatus` necesitan. `templateData` es el objeto completo devuelto por `getTemplate` (cuerpos, blobs de adjuntos comunes e imágenes inline): es el que usan `buildMessage_`, `runTestSend_` y la Fase B, de modo que el mensaje se arma con exactamente la plantilla cuyo `templateKey` se comparó (no se vuelve a llamar a `getTemplate` fuera de `buildPreflight_`). `templateKey` es el JSON de `{ subject, plainBody, htmlBody, nombres y tamaños de adjuntos comunes, cids inline, headers, from, replyTo }`. Con errores globales (configuración, encabezados, plantilla, remitente) `valid` queda vacío. Un marcador de la plantilla que no es un encabezado es error global de plantilla (`Marcador desconocido: {{X}}`), porque afecta a todas las filas; `renderTemplate_` lo sigue reportando por fila para la prueba.
- El tamaño de un archivo nativo se conoce recién al exportarlo; en la validación previa se valida acceso y tipo, y el tamaño final se controla en `buildMessage_` antes del claim.
- `attachmentNames` son los nombres de los archivos de la fila tal como los devuelve `getFileInfo` (sin URL ni ID), en el orden de la celda; se obtienen en la misma llamada que ya valida el acceso, sin llamadas extra a Drive.
- `formatRowReview_(report, limit = 20)` → texto en español para revisión humana (D-23): una línea `Adjuntos comunes: a.pdf, b.pdf` (o `Adjuntos comunes: ninguno`) con los nombres de `templateData.attachments`, y luego, por cada fila de `valid` en orden ascendente hasta `limit`, `Fila N → destinatario: archivo1, archivo2` (o `Fila N → destinatario (sin adjuntos propios)`); si hay más filas, `y N filas más`. Cada nombre y dirección pasa por `sanitizeHeaderValue_` (sin saltos de línea que puedan falsear líneas del diálogo). Nunca incluye URLs, IDs de Drive ni valores de otras columnas.
- `formatPreflightReport_(report)` → texto en español para `Ui.alert`: pestaña, borrador (asunto), remitente, Reply-To, cantidades de válidas / inválidas / excluidas (con desglose por motivo), cuota disponible, la revisión de `formatRowReview_` y hasta 20 filas inválidas con su número de fila y motivos; si hay más, `y N filas más`.

### `Send.js`

- `buildMessage_(deps, template, row, headersMap, config)` → `{ ok, message, errors }`. Renderiza con `renderTemplate_`, mapea imágenes inline, obtiene los adjuntos de la fila con `getFileInfo` + `getAttachment` (un fallo de Drive es error de la fila, nunca omisión silenciosa), controla el tamaño total con `checkAttachmentSizes_` y el del cuerpo con `utf8ByteLength_` (D-21) y arma `message = { to, subject, plainBody, htmlBody, attachments: [comunes..., de la fila...], inlineImages, from, replyTo }`. Es el **único** camino de armado, usado por la prueba y por el envío real (AC-15).
- `runTestSend_(deps, config, rowNumber)` → `{ ok, errors, to }`. Ejecuta `buildPreflight_` para errores globales (incluido `session.userEmail()` vacío, D-22: sin destinatario de prueba no se envía); lee la fila pedida (sin exigir elegibilidad, D-07); una fila fuera de rango (menor que 2 o mayor que la última fila con datos) o totalmente vacía es error, sin llamar a Gmail; `buildMessage_`; si hay errores, no llama a Gmail (AC-16). Si no: cambia solo `to` por `session.userEmail()` y antepone `TEST_SUBJECT_PREFIX` al asunto, llama a `gmail.send` una vez y agrega una línea de registro `PRUEBA`. Nunca llama a `writeStatus`.
- `prepareSend_(deps, config)` → **Fase A**, sin lock: `buildPreflight_` y devuelve `{ report, confirmed: { templateKey, rows: Map<rowNumber, key> } }` con las filas válidas. Si no hay filas válidas o hay errores globales, el controlador muestra el informe y termina.
- `executeSend_(deps, config, prepared, startedAt)` → **Fase B**:
  1. `lock.tryLock(LIMITS.LOCK_WAIT_MS)`; si falla, termina sin enviar (`Hay otra ejecución en curso; reintentá en unos minutos`) (AC-18).
  2. Dentro de `try { … } finally { lock.release() }`: `buildPreflight_` de nuevo desde cero. Si tiene errores globales o `templateKey` difiere del confirmado, cancela todo sin enviar (D-15). Genera `campaignId`.
  3. Recorre las filas confirmadas en orden ascendente. Para cada una: si `clock.now() - startedAt > MAX_RUNTIME_MS` o la cuota local llegó a 0, se detiene y deja el resto sin tocar (AC-22). Si la fila no está entre las válidas actuales o su clave difiere de la confirmada → se omite como `Cambió después de la confirmación` (AC-23, AC-24, AC-25).
  4. `readRow` de esa fila y comparación de clave otra vez (cubre ediciones humanas durante el recorrido, que no toman el lock).
  5. `buildMessage_` con el `templateData` y `headers` del informe de la Fase B; si falla → se omite con su motivo, sin escribir estado.
  6. Claim: `writeStatus(… ENVIANDO)`. Si lanza: se detiene la ejecución (estado incierto, nada enviado).
  7. `gmail.send(message)`. Si lanza: intenta `writeStatus(… REVISAR)`, registra `REVISAR` con el mensaje de error resumido y se **detiene** (D-16, AC-21).
  8. Antes de escribir el éxito, `readRow` y verifica que la fila siga siendo la misma (misma clave con el estado `ENVIANDO`); si no coincide (por ejemplo, se insertó una fila arriba), no escribe nada en esa posición, registra `REVISAR: la fila cambió de posición durante el envío` y se **detiene** (default conservador: la hoja se está reestructurando y las posiciones siguientes ya no son confiables). Si coincide: `writeStatus(… Email Sent)`. Si esa escritura lanza, la fila queda en `ENVIANDO` y se detiene (AC-20).
  9. `appendLogSafe_` después de cada resultado; decrementa la cuota local.

  Devuelve `{ campaignId, sent, skipped: [{ rowNumber, reason }], review: [{ rowNumber, reason }], stoppedReason, logErrors }`.
- `formatSendSummary_(result)` → texto en español: campaña, enviados (aceptados por Gmail), omitidos con motivo, filas para revisión manual, motivo de corte y aviso de errores de registro.
- `appendLogSafe_(deps, entry)` envuelve `appendLog` en `try/catch` y cuenta fallas (D-18). Una entrada es `{ date (Date), campaignId, sheetName, rowNumber, recipient, result, detail }` (identificadores en inglés), que el adaptador escribe en el orden de `LOG_HEADERS` (`Fecha`, `Campaña`, `Pestaña`, `Fila`, `Destinatario`, `Resultado`, `Detalle`); nunca cuerpo, asunto renderizado, URLs ni valores de otras columnas (AC-26).

### `Ui.js`

- `onOpen()` solo agrega el menú `Mail Merge`: `Configurar campaña…`, `Validar`, `Enviar prueba…`, `Enviar pendientes…`, `Ver registro`. No lee datos ni envía.
- Cada `menuX()` llama a `runX_(createServices_(), createUi_())`. `createUi_()` envuelve `SpreadsheetApp.getUi()`: `alert(title, text)`, `confirm(title, text) → bool` (botones `YES_NO`), `prompt(title, text) → string | null`, `showSidebar()`.
- `runValidate_(deps, ui)`: `buildPreflight_` + `formatPreflightReport_` en un `alert`. Cero envíos y cero escrituras (AC-27).
- `runTestSendFromUi_(deps, ui)`: `prompt` por el número de fila (entero ≥ 2); luego `runTestSend_` y un `alert` con el resultado.
- `runSendPending_(deps, ui)`:
  1. `startedAt = clock.now()`.
  2. Fase A: `prepareSend_`; si no hay nada que enviar, `alert` con el informe y fin.
  3. `confirm` con: pestaña, asunto del borrador, remitente, Reply-To, cantidad de filas a enviar, la revisión por fila de `formatRowReview_` (D-23: destinatario y nombres de adjuntos, hasta 20 filas) y la advertencia `Se enviarán N correos reales. Esta acción no se puede deshacer.` Si la respuesta no es "Sí", fin sin enviar (AC-17).
  4. Fase B: `executeSend_(deps, config, prepared, startedAt)` y `alert` con `formatSendSummary_`.
- `menuShowLog()` llama a `sheets.showLogSheet()`; si devuelve `false`, `alert('Todavía no hay registro.')`.
- `getConfigOptions()` (pública, la llama la sidebar) → `{ sheets, drafts, senders: [userEmail, ...aliases], current }`, excluyendo la pestaña de registro de `sheets`.
- `saveConfig(config)` (pública) revalida en el servidor: convierte `sheetId` (llega como texto desde el `select`) a entero y rechaza valores no numéricos; `sheetId` existe y no es la de registro; `draftId` está en `listDrafts()`; `from` está en los remitentes; `replyTo` vacío o válido. Si algo falla, lanza un `Error` con mensaje en español; si no, `props.setConfig`.

### `Sidebar.html`

Formulario con tres `select` (pestaña, borrador como `asunto — fecha`, remitente), un `input` para Reply-To, botones `Guardar` y `Cerrar`, y un área de mensajes. Se carga con `google.script.run.getConfigOptions()` y guarda con `saveConfig`. Todas las opciones y mensajes se insertan con `textContent` / `new Option(text, value)`, nunca con `innerHTML` de datos (riesgo 8 de REFERENCE_AUDIT).

### Scopes (`oauthScopes`)

Lista mínima propuesta, contrastada en la due diligence con la documentación vigente (ver "Due diligence record"):

- `https://www.googleapis.com/auth/spreadsheets.currentonly` — leer y escribir solo el Sheet vinculado.
- `https://www.googleapis.com/auth/script.container.ui` — menú, diálogos y sidebar.
- `https://mail.google.com/` — `GmailApp` (leer borradores, alias y enviar).
- `https://www.googleapis.com/auth/drive.readonly` — leer y exportar adjuntos; nunca cambiar permisos.
- `https://www.googleapis.com/auth/script.send_mail` — requerido por `MailApp.getRemainingDailyQuota()`.
- `https://www.googleapis.com/auth/userinfo.email` — `Session.getEffectiveUser().getEmail()`.

Sin `script.external_request`, sin `UrlFetchApp`, sin triggers instalables (AC-28).

**Riesgo aceptado (D-24):** `https://mail.google.com/` (todo el buzón) y `drive.readonly` (todo el Drive) son scopes amplios y restringidos. Se aceptan solo para el desarrollo local, donde no se otorgan ni se ejercen. Antes de cualquier uso real requieren autorización explícita y validación en vivo; `docs/OPERATIONS.md` y `docs/ACCEPTANCE_STATUS.md` los listan como primer punto `PENDING LIVE VALIDATION`.

## Máquina de estados

```text
(vacío) ── validación fallida ──> sin cambios (solo informe)
(vacío) ── Fase B, fila idéntica, mensaje armado ──> ENVIANDO
ENVIANDO ── Gmail aceptó + fila verificada ──> Email Sent
ENVIANDO ── Gmail lanzó excepción ──> REVISAR (y fin de la ejecución)
ENVIANDO ── corte, crash o falla al persistir el éxito ──> queda ENVIANDO (revisión manual)
SKIP / Email Sent / ENVIANDO / REVISAR / cualquier otro valor ──> excluido de envíos automáticos
```

`ENVIANDO` y `REVISAR` se resuelven a mano: el operador revisa la carpeta Enviados de Gmail y escribe `Email Sent` si el correo salió, o vacía la celda para que la fila vuelva a ser elegible. La guía de operación lo explica.

## Qué no cambia

- Los documentos de `docs/` existentes (insumos) y `AGENTS.md`; `CLAUDE.md` ya tiene las convenciones.
- No se agregan columnas al Sheet del operador, no se cambian permisos de Drive, no se crean triggers, no se programa nada.
- No se agrega `package.json`, dependencias, ESLint ni bundler: `node --test` descubre `*.test.js`.

## Casos borde

- Pestaña configurada borrada → error global `La pestaña configurada ya no existe; volvé a configurar la campaña`.
- Borrador configurado borrado o enviado → error global de plantilla (falla cerrado, R-02).
- Alias quitado de la cuenta después de configurar → error global (AC-14).
- Fila con `Email Address` vacío pero otros datos → inválida `Falta Email Address`.
- Valor con `<script>`, `&`, comillas o saltos de línea → escapado en HTML; en el asunto sin CR/LF (AC-02).
- Valor que contiene `{{Otra}}` → no se reinterpreta: la sustitución es de una sola pasada; el texto resultante sí se controla con `findUnresolvedTokens_`, por lo que la fila queda bloqueada con un motivo claro.
- Fila con estado vacío pero oculta → excluida y contada aparte (AC-11).
- Dos operadores confirman a la vez → el segundo espera el lock hasta `LOCK_WAIT_MS`; si lo obtiene después, sus filas ya tienen `Email Sent`, las claves no coinciden y se omiten (AC-18, AC-25).
- Doble clic en `Enviar pendientes…` → mismo caso anterior.
- Se inserta una fila arriba durante el envío → pasos 4 y 8 de la Fase B evitan escribir el estado en la fila equivocada.
- Cuota en 0 al iniciar la Fase B → no envía nada y lo informa.
- Columna con fórmulas volátiles (`=NOW()`, `=RAND()`) → la clave de la fila cambia entre fases y la fila se omite siempre como `Cambió después de la confirmación` (falla cerrado). Se documenta en `docs/OPERATIONS.md`.

## Escenarios de prueba

Herramientas: `node:test` y `node:assert/strict`. El cargador `vm` expone las funciones globales; las constantes se leen con `vm.runInContext('NOMBRE', ctx)`. Cada llamada al cargador crea un contexto nuevo, para que un test que modifique `LIMITS` no afecte a otros.

Objetos de otro realm: los arrays, objetos, `Map`, `Date` y `Error` creados dentro del contexto `vm` tienen prototipos distintos a los del proceso de test, por lo que `assert.deepStrictEqual` falla aunque el contenido sea igual, e `instanceof Error` / `instanceof Date` dan `false`. Los tests normalizan con un helper (`plain(x)`, `JSON.parse(JSON.stringify(x))`, convirtiendo antes `Map` a array), comparan `Date` con `Object.prototype.toString.call(x) === '[object Date]'` y usan `assert.throws(fn, /mensaje/)` en lugar de clases de error.

Los falsos registran `sent[]`, `statusWrites[]`, `logEntries[]`, `lockCalls`, y permiten:
- inyectar fallas en puntos concretos: `failOn: { send, writeStatus: { value, afterWrite }, getFileInfo: { id }, appendLog }`. Con `afterWrite: true` el falso persiste el valor y después lanza (simula un `flush` o un crash posterior a la escritura); sin él, lanza sin escribir;
- fijar valores de reloj y cuota;
- mutar la hoja o la plantilla durante la Fase B mediante ganchos `hooks: { beforeReadRow(rowNumber), afterSend(message) }`, necesarios para las ediciones durante el recorrido (AC-23) y la fila desplazada después del envío (paso 8). Las ediciones entre la Fase A y la Fase B se hacen mutando el falso entre `prepareSend_` y `executeSend_`. El fixture reproduce `docs/ACCEPTANCE.md`: pestaña `Recipients` con `Email Address`, `First Name`, `Reference`, `File Attachments`, `Mail Merge Status`, `Scheduled Date`; direcciones `alpha@example.test`, `beta@example.test`, `gamma@example.test`; borrador con asunto `Notice {{Reference}}`, HTML con `{{First Name}}`, una imagen inline y un PDF común; Drive con dos PDF y un documento nativo.

| Test | Cubre |
|---|---|
| Dos filas con valores distintos generan asuntos y cuerpos distintos sin fuga entre filas | AC-01 |
| `<script>`, `&`, comillas y salto de línea: HTML escapado, asunto sin CR/LF, texto plano con el valor | AC-02 |
| `{{Not a column}}`: `renderTemplate_` bloquea la fila con `Marcador desconocido` y no reemplaza por vacío; `buildPreflight_` lo informa como error global con `valid` vacío | AC-03 |
| Marcador con valor vacío bloquea la fila | AC-04 |
| Dos enlaces separados por coma adjuntan exactamente esos dos archivos | AC-05 |
| Adjunto común + adjunto de la fila; el de otra fila nunca aparece | AC-06 |
| Archivo inexistente o sin acceso: fila inválida y cero llamadas a `send` | AC-07 |
| Documento nativo: exportación a PDF con nombre `.pdf` y MIME `application/pdf` | AC-08 |
| Tamaño total por encima del límite: cero llamadas a `send` y error accionable | AC-09 |
| `SKIP`, `Email Sent`, `REVISAR`, `ENVIANDO` y un valor arbitrario quedan excluidos | AC-10 |
| Fila oculta por usuario y por filtro excluidas de la validación y del envío | AC-11 |
| Encabezado duplicado, falta `Email Address`, falta `Mail Merge Status` o capitalización distinta: error global | AC-12 |
| Destinatario inválido bloqueado antes de la API | AC-13 |
| Alias no autorizado: error global, cero envíos | AC-14 |
| Prueba: mismo mensaje que el real salvo `to` y prefijo `[PRUEBA] `; estado sin cambios | AC-15 |
| Prueba con un adjunto faltante: falla cerrado, cero envíos, estado sin cambios | AC-16 |
| `confirm` devuelve falso: cero envíos y cero escrituras | AC-17 |
| Lock no disponible: cero envíos; dos ejecuciones secuenciales: un solo envío por fila | AC-18 |
| Crash después de persistir `ENVIANDO` (`failOn.writeStatus: { value: 'ENVIANDO', afterWrite: true }`): cero envíos, ejecución detenida, la fila queda `ENVIANDO`; segunda ejecución no reintenta. Variante sin `afterWrite`: cero envíos y ejecución detenida (la fila sigue vacía porque no hubo claim ni envío) | AC-19 |
| Gmail acepta y falla la escritura de `Email Sent`: la fila queda `ENVIANDO`; segunda ejecución no reenvía | AC-20 |
| `send` lanza: fila `REVISAR`, ejecución detenida, filas siguientes intactas | AC-21 |
| Reloj por encima del presupuesto o cuota agotada: corte limpio; filas no reclamadas siguen vacías | AC-22 |
| Edición del destinatario o del enlace entre Fase A y Fase B: la fila se omite; edición durante el recorrido: idem | AC-23 |
| Filas reordenadas entre fases: ninguna fila se envía con datos de otra | AC-24 |
| Re-ejecución después de un envío exitoso: cero duplicados | AC-25 |
| Registro: tiene fecha, campaña, fila, destinatario y resultado; no tiene cuerpo, asunto, URLs ni otras columnas | AC-26 |
| `runValidate_`: cero `send`, cero `writeStatus`, cero `appendLog` | AC-27 |
| Manifest: `runtimeVersion` V8, `oauthScopes` exactamente la lista aprobada, sin `webapp` ni `executionApi`; ningún `src/*.js` usa `UrlFetchApp`, `ScriptApp.newTrigger` ni `setSharing` | AC-28 |
| Fila con `Scheduled Date` con valor: excluida y contada | D-03 (nuevo AC-31) |
| Plantilla modificada entre Fase A y Fase B: cancelación total sin envíos | D-15 |
| Fila desplazada entre el envío y el registro del éxito (gancho `afterSend` inserta una fila arriba): no escribe en otra fila; registra `REVISAR` y detiene la ejecución | Fase B paso 8 |
| `runTestSend_` con fila fuera de rango o vacía: error, cero envíos | D-07 |
| `saveConfig` convierte `sheetId` de texto a número; `getConfigOptions` devuelve fechas de borradores como texto | Sidebar |
| `saveConfig` rechaza pestaña inexistente, borrador ajeno, alias no autorizado y Reply-To inválido | R-02, R-04 |
| `parseDriveLinks_`: formatos válidos, host ajeno, `http://`, ID suelto, ID repetido, piezas vacías | R-05 |
| `utf8ByteLength_` con ASCII, acentos y emoji; cuerpo renderizado por encima de `MAX_BODY_BYTES`: fila inválida en validación y cero envíos | D-21 |
| `session.userEmail()` vacío: error global en la validación y la prueba no llama a `send` | D-22 |
| `formatRowReview_`: nombres de adjuntos comunes; `Fila N → destinatario: nombres`; 25 filas válidas → 20 líneas y `y 5 filas más`; sin URLs ni IDs; nombres con salto de línea saneados; el informe de `Validar` y el texto de `confirm` la incluyen | D-23 |

AC-29 (repositorio local sin remoto, sin secretos) y AC-30 (tests offline sin credenciales ni red) se verifican con los comandos de la sección siguiente y se documentan en `docs/ACCEPTANCE_STATUS.md`.

## Verificación

Desde la raíz del proyecto, con Node portable en el PATH del proceso (ver `CLAUDE.md`):

- `node --test` → todos los tests pasan, sin red ni credenciales.
- `node --check src/<archivo>.js` para cada fuente y `node --check tests/<archivo>.js` para cada test.
- `git diff --check`, `git status --short`, `git remote -v` (vacío).
- Revisión manual de `src/appsscript.json` contra la lista de scopes.

## Pendiente de validación en vivo (`PENDING LIVE VALIDATION`)

No se puede comprobar localmente y queda en `docs/OPERATIONS.md` como checklist para una activación futura autorizada: comportamiento real de `Ui.alert` y `LockService` en el runtime; scopes efectivos y pantalla de consentimiento; alias y Reply-To reales; cuota real de la cuenta; aspecto del HTML, imágenes inline y firma en una casilla de prueba; exportación a PDF de archivos nativos y tamaños reales; detección de filas ocultas por filtro; tiempos reales por fila frente a `MAX_RUNTIME_MS`.

## Due diligence record

Registro de lo que concluyó la due diligence del 2026-11-08 sobre los hechos externos que el plan cita o difiere; lo leen las pasadas posteriores (incluido el chequeo de hechos de la implementación). Ninguna pasada puede tomar una línea de esta sección como motivo para saltear una verificación: el registro dice lo que se concluyó una vez, no lo que es cierto hoy. Quien edite a mano el hecho correspondiente debe **borrar** la línea en lugar de actualizarla, para que la sección no afirme cosas que nadie verificó.

- SETTLED: `MAX_TOTAL_ATTACHMENT_BYTES: 20 * 1024 * 1024` queda bajo el límite "Email total attachments size 25 MB / msg" (verificado contra developers.google.com/apps-script/guides/services/quotas)
- SETTLED: `MAX_RUNTIME_MS: 270000` queda bajo el límite "Script runtime 6 min / execution" (verificado contra developers.google.com/apps-script/guides/services/quotas)
- SETTLED: `"runtimeVersion": "V8"` y los campos `oauthScopes`, `webapp`, `executionApi`, `dependencies` existen en el manifest (verificado contra developers.google.com/apps-script/manifest)
- SETTLED: `https://mail.google.com/` es el scope listado para `GmailApp.sendEmail`, `getAliases`, `getDraft`, `getDrafts` y `GmailMessage.getAttachments` (verificado contra la referencia de GmailApp y GmailMessage)
- SETTLED: `https://www.googleapis.com/auth/script.send_mail` es el scope de `MailApp.getRemainingDailyQuota()` (verificado contra la referencia de MailApp)
- SETTLED: `https://www.googleapis.com/auth/userinfo.email` es el scope de `Session.getEffectiveUser()` (verificado contra la referencia de Session)
- SETTLED: `https://www.googleapis.com/auth/script.container.ui` es el scope de `Ui.showSidebar`; `alert`, `prompt` y `createMenu` no listan scope (verificado contra la referencia de Ui)
- SETTLED: `https://www.googleapis.com/auth/drive.readonly` alcanza para `DriveApp.getFileById`, `File.getSize`, `getMimeType`, `isTrashed`; `getAs` no lista scope (verificado contra la referencia de DriveApp y File)
- SETTLED: `https://www.googleapis.com/auth/spreadsheets.currentonly` alcanza para `getDataRange`, `getSheetId`, `isRowHiddenByFilter`, `isRowHiddenByUser` (verificado contra la referencia de Sheet)
- SETTLED: `Ui.alert` suspende el script del servidor mientras el diálogo está abierto (verificado contra la referencia de Ui)
- SETTLED: `LockService.getDocumentLock()` devuelve `null` fuera de un documento contenedor; `Lock.tryLock(ms)` devuelve booleano y la liberación es `Lock.releaseLock()` (verificado contra la referencia de LockService y Lock)
- SETTLED: `File.getSize()` devuelve 0 para archivos nativos de Google Workspace, coherente con controlar el tamaño de los exportados recién en `buildMessage_` (verificado contra la referencia de File)
- SETTLED: `getAttachments({ includeInlineImages: true, includeAttachments: false })` y emparejamiento de imágenes inline por `alt` = `getName()`, porque `GmailAttachment` no expone el Content-ID (verificado contra la referencia de GmailAttachment y GmailMessage y la muestra oficial googleworkspace/apps-script-samples solutions/automations/mail-merge)
- SETTLED: opciones `from` (debe ser uno de `getAliases()`), `replyTo`, `htmlBody`, `attachments`, `inlineImages` (objeto clave → blob, referenciado como `cid:clave`) de `GmailApp.sendEmail` (verificado contra la referencia de GmailApp)
- OPEN (unverified): `"timeZone": "Etc/UTC"`, la documentación pide un ZoneId (ejemplo `America/Denver`) sin enumerar los valores aceptados; `Etc/UTC` es un ZoneId de Java válido pero no se confirmó que Apps Script lo acepte
- OPEN (unverified): scopes más acotados que `https://mail.google.com/`, la referencia de GmailApp admite "appropriate scopes from the related REST API" pero no se verificó qué combinación concreta funciona para borradores, alias y envío
- OPEN (deferred): límite de tamaño del cuerpo del mensaje (200 KB / msg en cuentas de consumo, 400 KB / msg en Workspace según la página de cuotas), el plan no lo controla ni lo hace configurable

## Implementation steps

Convenciones comunes a todos los pasos:

- Node portable en el PATH solo del proceso (Git Bash): `export PATH="/ruta/a/node:$PATH"`. Todos los comandos se ejecutan desde la raíz del proyecto. Sin `npm install`, sin `package.json`.
- Los archivos de `src/` son scripts globales de Apps Script: sin `module.exports`, sin `require`, solo declaraciones de funciones y constantes en el nivel superior. Los archivos de `tests/` sí son CommonJS de Node.
- Los títulos de los tests incluyen el ID que cubren (`AC-xx`, `D-xx`, `R-xx`) para la trazabilidad de `docs/ACCEPTANCE_STATUS.md`.
- Los helpers de test no se nombran `test-*.js` ni `*.test.js` (el descubrimiento por defecto de `node --test` los ejecutaría como tests).
- Cada paso termina con un commit local, Conventional Commits en español, stage por nombre de archivo.

### Step 1: Manifest, constantes, hoja y cargador `vm`

- **Files**: crear `tests/helpers/load-apps-script.js`, `tests/sheet.test.js`, `tests/manifest.test.js`, `src/appsscript.json`, `src/Config.js`, `src/Sheet.js`.
- **Do**:
  1. `tests/helpers/load-apps-script.js` (CommonJS): `loadAppsScript(extraGlobals = {})` crea un contexto nuevo con `vm.createContext({ ...extraGlobals })`, lee todos los `src/*.js` en orden alfabético y ejecuta cada uno con `vm.runInContext(code, ctx, { filename })`; devuelve `ctx`. Cada llamada crea un contexto nuevo (un test que mute `LIMITS` no afecta a otros). Exportar también `getConst(ctx, name)` → `vm.runInContext(name, ctx)`, `plain(x)` (convierte `Map` a array de pares en forma recursiva y luego `JSON.parse(JSON.stringify(x))`) e `isDate(x)` (`Object.prototype.toString.call(x) === '[object Date]'`).
  2. `tests/sheet.test.js` y `tests/manifest.test.js` (ver **Test**) antes del código de producción.
  3. `src/appsscript.json`: `timeZone: "Etc/UTC"`, `runtimeVersion: "V8"`, `oauthScopes` exactamente los seis de la sección "Scopes"; sin `dependencies`, `webapp` ni `executionApi`.
  4. `src/Config.js`: exactamente las constantes de "Detalle del código > Config.js" (`HEADERS`, `STATUS`, `TEST_SUBJECT_PREFIX`, `LIMITS`, `LOG_SHEET_NAME`, `LOG_HEADERS`, `PROPERTY_KEYS`, `GOOGLE_EXPORTABLE_MIME_TYPES`), con comentarios en español que expliquen el margen de cada límite.
  5. `src/Sheet.js`: `mapHeaders_(headerRow)`, `classifyRows_(sheetData, columns)`, `isValidEmail_(value)`, `rowKey_(values)` con el contrato de "Detalle del código > Sheet.js". `classifyRows_` recibe el objeto de `readSheet` (`values`, `hiddenByUser`, `hiddenByFilter`) y `columns` de `mapHeaders_`; `rowNumber` = índice + 1; ignora filas totalmente vacías (las cuenta en `blankRows`); aplica los motivos de exclusión en el orden indicado (`oculta por el usuario`, `oculta por un filtro`, `estado: <valor>`, `Scheduled Date con valor`); si la columna `Scheduled Date` no existe, ese criterio no aplica. Mensajes de error de `mapHeaders_` en español (falta de encabezado requerido, encabezado duplicado, encabezado ambiguo por capitalización o espaciado).
- **Test**:
  - `tests/sheet.test.js`:
    - AC-12: `mapHeaders_` con encabezado duplicado (incluido el duplicado normalizado `First Name` / `first  name`), sin `Email Address`, sin `Mail Merge Status`, con `email address` en lugar de `Email Address` → `ok: false` con error en cada caso; encabezados válidos con espacios alrededor y celdas de encabezado vacías → `ok: true`, `columns` con índices 0-based correctos y `scheduled` ausente (valor documentado en el código, por ejemplo `-1`) si falta la columna.
    - AC-10: filas con estado `SKIP`, `Email Sent`, `ENVIANDO`, `REVISAR` y `2026-01-01` → en `excluded` con `estado: <valor>`; fila con estado vacío → `eligible`.
    - AC-11: fila oculta por el usuario y fila oculta por un filtro → excluidas con su motivo, aun con estado vacío.
    - D-03 (nuevo AC-31): fila con `Scheduled Date` con valor → excluida con `Scheduled Date con valor`; sin columna `Scheduled Date` la fila es elegible.
    - Fila totalmente vacía → no aparece en ninguna lista y suma a `blankRows`; el `rowNumber` de la primera fila de datos es 2.
    - AC-13 (unidad): `isValidEmail_` acepta `alpha@example.test`; rechaza vacío, `a b@example.test`, `a@example.test, b@example.test`, `a@example.test;b@x.test`, `<a@example.test>`, `"a"@example.test`, valor con `\r\n`, sin dominio y dirección de más de 254 caracteres.
    - `rowKey_` devuelve el mismo texto para valores iguales y uno distinto si cambia una celda.
  - `tests/manifest.test.js` (AC-28): `runtimeVersion === 'V8'`; `oauthScopes` (ordenados) iguales a la lista aprobada de seis; sin `webapp`, `executionApi` ni `dependencies`; ningún archivo de `src/` (`.js` y `.html`, leídos en forma dinámica para cubrir los pasos siguientes) contiene `UrlFetchApp`, `ScriptApp.newTrigger` ni `setSharing`. Además, mediante `getConst`: `HEADERS.EMAIL === 'Email Address'`, `STATUS.SENDING === 'ENVIANDO'`, `STATUS.REVIEW === 'REVISAR'` y `TEST_SUBJECT_PREFIX === '[PRUEBA] '`.
- **Verify**: `node --test` (todo pasa); `node --check` sobre `src/Config.js`, `src/Sheet.js`, `tests/helpers/load-apps-script.js`, `tests/sheet.test.js`, `tests/manifest.test.js`; `node -e "JSON.parse(require('fs').readFileSync('src/appsscript.json','utf8'))"` sin error; `git diff --check` sin salida.

### Step 2: Plantillas y adjuntos de Drive (lógica pura)

- **Files**: crear `tests/template.test.js`, `tests/attachments.test.js`, `src/Template.js`, `src/Attachments.js`.
- **Do**:
  1. Tests primero (ver **Test**).
  2. `src/Template.js`: `escapeHtml_`, `sanitizeHeaderValue_`, `extractTokens_(text, { html })`, `renderTemplate_(template, rowValuesByHeader)`, `findUnresolvedTokens_(text)`, `mapInlineImages_(htmlBody, inlineImages)`, `utf8ByteLength_(s)` según "Detalle del código > Template.js". `template` es `{ subject, plainBody, htmlBody }`; `rowValuesByHeader` es `{ [encabezado]: valor mostrado }`. La sustitución se hace en una sola pasada con función de reemplazo sobre `/{{\s*([^{}]+?)\s*}}/g`; en el HTML, el nombre capturado se decodifica de entidades antes de buscarlo. Mensajes: `Marcador desconocido: {{X}}` y `El campo "X" está vacío`. `utf8ByteLength_` recorre code points (un par sustituto = 4 bytes) sin `Buffer` ni `Utilities`.
  3. `src/Attachments.js`: `parseDriveLinks_(cell)`, `classifyDriveFile_(info)`, `checkAttachmentSizes_(attachments, maxBytes)` según "Detalle del código > Attachments.js". Los errores nunca incluyen la URL ni el ID (`Enlace de adjunto n.º N no válido`, `Enlace de adjunto n.º N repetido`); `checkAttachmentSizes_` suma `size` y, si supera `maxBytes`, devuelve un error accionable en español con el total y el máximo en MB.
- **Test**:
  - `tests/template.test.js`:
    - AC-01: dos juegos de valores distintos sobre la misma plantilla producen asuntos y cuerpos distintos, y ninguno contiene el valor del otro.
    - AC-02: valor `<script>alert("x")</script> & 'q'` + salto de línea → HTML con `&lt;script&gt;`, `&amp;`, `&quot;`, `&#39;`; asunto sin `\r` ni `\n`; texto plano con el valor crudo.
    - AC-03: `{{Not a column}}` → `ok: false`, error `Marcador desconocido: {{Not a column}}`, sin reemplazo por vacío.
    - AC-04: marcador con valor vacío o solo espacios → `ok: false` con `El campo "X" está vacío`.
    - `extractTokens_` con `html: true` decodifica `{{R&amp;D}}` y `{{First&nbsp;Name}}`; un valor con `$&` o `$1` se inserta literal; un valor que contiene `{{Otra}}` no se reinterpreta y `findUnresolvedTokens_` lo detecta; `{{First <b>Name</b>}}` queda detectado como no resuelto.
    - `mapInlineImages_`: `<img src="cid:logo" alt="logo.png">` con imagen inline `logo.png` → `{ logo: blob }`; `cid` sin `alt` o con `alt` sin coincidencia → `ok: false`.
    - D-21: `utf8ByteLength_('abc') === 3`, `utf8ByteLength_('á') === 2`, `utf8ByteLength_('€') === 3`, `utf8ByteLength_('😀') === 4`.
  - `tests/attachments.test.js`:
    - R-05 / AC-05: dos enlaces válidos separados por coma (con espacios y una pieza vacía) → exactamente esos dos IDs, en orden; cada formato aceptado (`/file/d/`, `open?id=`, `uc?id=`, `docs.google.com/document|spreadsheets|presentation/d/`) extrae el ID.
    - Rechazos: host ajeno, `http://`, ID suelto, ID corto (< 20 caracteres) e ID repetido en la misma celda; los mensajes no contienen la URL ni el ID.
    - AC-08 (unidad): `classifyDriveFile_` → `export-pdf` para documento, hoja y presentación; error `tipo no soportado` para `application/vnd.google-apps.form` y `.folder`; error para `trashed: true`; `binary` para `application/pdf`.
    - AC-09 (unidad): `checkAttachmentSizes_` por debajo, igual y por encima del máximo; por encima → `ok: false` con error accionable.
- **Verify**: `node --test` (todo pasa, incluidos los tests del paso 1); `node --check` sobre `src/Template.js`, `src/Attachments.js`, `tests/template.test.js`, `tests/attachments.test.js`; `git diff --check` sin salida.

### Step 3: Falsos, fixture, validación previa, armado de mensaje y envío de prueba

- **Files**: crear `tests/fixtures/campaign.js`, `tests/helpers/fakes.js`, `tests/preflight.test.js`, `tests/test-send.test.js`, `src/Preflight.js`, `src/Send.js` (en este paso solo `buildMessage_`, `runTestSend_` y `appendLogSafe_`).
- **Do**:
  1. `tests/fixtures/campaign.js`: `createCampaignFixture()` devuelve datos nuevos en cada llamada, sintéticos según `docs/ACCEPTANCE.md`: pestaña `Recipients` (id numérico, por ejemplo `101`) con encabezados `Email Address`, `First Name`, `Reference`, `File Attachments`, `Mail Merge Status`, `Scheduled Date`; filas `alpha@example.test`, `beta@example.test`, `gamma@example.test` con enlaces de Drive sintéticos (IDs de 20 caracteres o más); pestaña `Registro Mail Merge` en `listSheets`; borrador con asunto `Notice {{Reference}}`, HTML con `{{First Name}}` y `<img src="cid:logo" alt="logo.png">`, texto plano, un PDF común y la imagen inline `logo.png`; Drive con dos PDF y un documento nativo (`application/vnd.google-apps.document`, `size: 0`); `config` válido (`sheetId`, `draftId`, `from` = cuenta propia, `replyTo: ''`); cuenta `operator@example.test` y alias `alias@example.test`. Los blobs son objetos planos identificables (por ejemplo `{ fakeBlob: 'pdf-alpha' }`).
  2. `tests/helpers/fakes.js`: `createFakeDeps(fixture, options = {})` implementa el contrato completo de `deps` del plan (`sheets`, `gmail`, `drive`, `lock`, `quota`, `session`, `props`, `clock`, `ids`) sobre el estado mutable del fixture y expone `calls = { sent: [], statusWrites: [], logEntries: [], lockCalls: [] }`. Soporta desde este paso todo lo que usa el paso 4: `failOn: { send, writeStatus: { value, afterWrite }, getFileInfo: { id }, appendLog }`; reloj y cuota configurables (`options.now`, `options.quota`); lock no disponible (`options.lockAvailable: false`); ganchos `hooks: { beforeReadRow(rowNumber), afterSend(message) }`; y helpers de mutación (`setCell(rowNumber, header, value)`, `insertRowAbove(rowNumber, values)`, `swapRows(a, b)`, `setTemplate(patch)`). `writeStatus` escribe en `values` del fixture; `getAttachment` de un nativo devuelve `{ name: name + '.pdf', mimeType: 'application/pdf', size, blob }`; `getFileInfo` lanza para IDs inexistentes o marcados sin acceso; `session.userEmail()` configurable (`options.userEmail`, admite `''`).
  3. Tests primero (ver **Test**).
  4. `src/Preflight.js`: `buildPreflight_(deps, config)`, `formatRowReview_(report, limit = 20)` y `formatPreflightReport_(report)` según "Detalle del código > Preflight.js", con el resultado exacto descrito (`ok`, `globalErrors`, `sheet`, `template`, `templateData`, `from`, `replyTo`, `headers`, `templateKey`, `valid` con `attachmentNames`, `invalid`, `excluded`, `quotaRemaining`). La revisión por fila (D-23) usa los nombres ya obtenidos con `getFileInfo`, sin llamadas extra a Drive. Solo lectura: nunca llama a `gmail.send`, `sheets.writeStatus` ni `sheets.appendLog`. Errores globales en español para configuración incompleta, pestaña inexistente (`La pestaña configurada ya no existe; volvé a configurar la campaña`), borrador inexistente, marcador desconocido, imagen inline sin emparejar, cuenta vacía (`No se pudo identificar la cuenta que ejecuta`, D-22), remitente no autorizado y Reply-To inválido. Fila con `Email Address` vacío → inválida `Falta Email Address`. Los nativos se validan por acceso y tipo; los binarios suman `size` junto con los adjuntos comunes.
  5. `src/Send.js` (parcial): `buildMessage_(deps, template, row, headersMap, config)` (único camino de armado, AC-15; un fallo de Drive o de tamaño es error de la fila); `runTestSend_(deps, config, rowNumber)` (D-06, D-07: fila fuera de rango o vacía es error; reemplaza solo `to` por `session.userEmail()` y antepone `TEST_SUBJECT_PREFIX`; registra `PRUEBA` con `appendLogSafe_`; nunca `writeStatus`); `appendLogSafe_(deps, entry)` (D-18; devuelve `true`/`false` para que el llamador cuente fallas). Las entradas de registro tienen solo `{ date, campaignId, sheetName, rowNumber, recipient, result, detail }`.
- **Test**:
  - `tests/preflight.test.js`:
    - AC-27 (núcleo): `buildPreflight_` sobre el fixture → `calls.sent`, `calls.statusWrites` y `calls.logEntries` vacíos; `valid` con las filas elegibles; `templateData` y `headers` presentes.
    - AC-03 (global): plantilla con `{{Not a column}}` → `globalErrors` con `Marcador desconocido` y `valid` vacío.
    - AC-07: enlace a un archivo inexistente o sin acceso → esa fila en `invalid`, las demás válidas.
    - AC-09: binarios + comunes por encima de `LIMITS.MAX_TOTAL_ATTACHMENT_BYTES` (bajar el límite con `vm.runInContext` en un contexto propio) → fila inválida con error accionable.
    - AC-12 / AC-13 / AC-14: encabezado duplicado → error global; destinatario inválido → fila inválida; `from` fuera de `[userEmail, ...aliases]` → error global con `valid` vacío.
    - D-21: cuerpo renderizado por encima de `MAX_BODY_BYTES` (límite reducido) → fila inválida con `El cuerpo del correo supera el tamaño máximo permitido`.
    - D-22: `userEmail` vacío → error global `No se pudo identificar la cuenta que ejecuta`.
    - Pestaña borrada y borrador borrado → error global; `templateKey` cambia si cambia el asunto o el `replyTo`.
    - `formatPreflightReport_` con 25 filas inválidas → muestra 20 y `y 5 filas más`; incluye pestaña, asunto, remitente, cantidades, cuota y la revisión de `formatRowReview_`.
    - D-23: `valid[i].attachmentNames` coincide con los nombres de los archivos de la fila en el orden de la celda; `formatRowReview_` muestra `Adjuntos comunes:` con el PDF común y `Fila N → alpha@example.test: <nombres>`; con 25 filas válidas → 20 líneas y `y 5 filas más`; la salida no contiene `drive.google.com`, `docs.google.com` ni IDs de Drive; un nombre de archivo con salto de línea queda en una sola línea.
  - `tests/test-send.test.js`:
    - AC-05 / AC-06 / AC-08: `buildMessage_` para la fila con dos enlaces → adjuntos = PDF común + exactamente esos dos archivos; el documento nativo llega como `<nombre>.pdf` con `application/pdf`; el adjunto de otra fila no aparece.
    - AC-15: `runTestSend_` envía una sola vez; el mensaje enviado es igual a `buildMessage_` de la misma fila salvo `to` (= cuenta del operador) y el asunto con prefijo `[PRUEBA] `; `calls.statusWrites` vacío; una entrada de registro `PRUEBA`.
    - AC-16: prueba con un adjunto faltante → `ok: false`, cero `send`, estado sin cambios.
    - D-07: `runTestSend_` con fila 1, fila mayor que la última y fila totalmente vacía → error, cero `send`; con una fila en estado `Email Sent` (no elegible) la prueba sí se envía.
    - D-22: `userEmail` vacío → cero `send`.
    - D-18: `appendLog` que lanza → `runTestSend_` sigue `ok` y reporta la falla de registro.
- **Verify**: `node --test` (todo pasa); `node --check` sobre `src/Preflight.js`, `src/Send.js`, `tests/fixtures/campaign.js`, `tests/helpers/fakes.js`, `tests/preflight.test.js`, `tests/test-send.test.js`; `git diff --check` sin salida.

### Step 4: Envío en dos fases con lock y checkpoint por fila

- **Files**: modificar `src/Send.js` (agregar `prepareSend_`, `executeSend_`, `formatSendSummary_`); crear `tests/send.test.js`; modificar `tests/helpers/fakes.js` solo si falta algún gancho o inyección de falla.
- **Do**:
  1. Tests primero (ver **Test**). Cada test arma el flujo `prepareSend_` → (mutación opcional del falso) → `executeSend_(deps, config, prepared, startedAt)`.
  2. `prepareSend_(deps, config)` → `{ report, confirmed: { templateKey, rows: Map<rowNumber, key> } }` (Fase A, sin lock).
  3. `executeSend_` siguiendo al pie de la letra los pasos 1 a 9 de "Detalle del código > Send.js": `tryLock(LIMITS.LOCK_WAIT_MS)` (si falla, `stoppedReason = 'Hay otra ejecución en curso; reintentá en unos minutos'`, sin enviar); `try/finally` con `lock.release()`; nuevo `buildPreflight_` y cancelación total si hay errores globales o cambió `templateKey` (D-15); `campaignId = ids.newCampaignId()`; recorrido ascendente con corte por tiempo (`clock.now() - startedAt > LIMITS.MAX_RUNTIME_MS`) o cuota local en 0 (AC-22); omisión `Cambió después de la confirmación` si la fila no está entre las válidas actuales o su clave difiere; `readRow` + comparación de clave; `buildMessage_` con `templateData` y `headers` del informe de la Fase B; claim `ENVIANDO` (si lanza → se detiene); `gmail.send` (si lanza → intenta `REVISAR`, registra y se detiene, D-16); `readRow` posterior y verificación de la clave con estado `ENVIANDO` (si no coincide → no escribe, registra `REVISAR: la fila cambió de posición durante el envío` y se detiene); `writeStatus(Email Sent)` (si lanza → la fila queda `ENVIANDO` y se detiene, AC-20); `appendLogSafe_` después de cada resultado y decremento de la cuota local. Devuelve `{ campaignId, sent, skipped, review, stoppedReason, logErrors }`. Ningún motivo ni entrada de registro incluye cuerpo, asunto renderizado ni URLs.
  4. `formatSendSummary_(result)` → texto en español: campaña, `N correos aceptados por Gmail` (D-13: nunca "entregados"), omitidos con motivo, filas para revisión manual, motivo de corte y aviso si hubo errores de registro.
- **Test** (`tests/send.test.js`):
  - Camino feliz: cada fila válida pasa por `ENVIANDO` → `send` → `Email Sent` en ese orden (verificar el orden combinado de `statusWrites` y `sent`); `lock.release` llamado una vez.
  - AC-18: `lockAvailable: false` → cero `send`, cero `writeStatus`, `stoppedReason` con el mensaje de lock; dos ejecuciones completas secuenciales → un solo `send` por fila.
  - AC-19: `failOn.writeStatus: { value: 'ENVIANDO', afterWrite: true }` → cero `send`, ejecución detenida, la fila queda `ENVIANDO` y una segunda ejecución no la reintenta; variante sin `afterWrite` → cero `send`, ejecución detenida, la fila sigue vacía.
  - AC-20: `failOn.writeStatus: { value: 'Email Sent' }` → un `send`, la fila queda `ENVIANDO`, ejecución detenida; segunda ejecución → cero `send` para esa fila.
  - AC-21: `failOn.send` → fila `REVISAR`, ejecución detenida, filas siguientes sin `writeStatus`.
  - AC-22: reloj por encima de `MAX_RUNTIME_MS` desde `startedAt` → cero envíos; cuota 1 con tres filas → un envío, y las filas no reclamadas siguen vacías y elegibles.
  - AC-23: edición del destinatario o del enlace entre Fase A y Fase B → esa fila se omite como `Cambió después de la confirmación` y las demás se envían; edición durante el recorrido con `hooks.beforeReadRow` → idem.
  - AC-24: `swapRows` entre fases → ninguna fila se envía con datos de otra (cada `to` coincide con la dirección confirmada para ese número de fila, o la fila se omite).
  - AC-25: re-ejecución después de un envío exitoso → cero duplicados.
  - AC-26: entradas de registro de un envío exitoso → `date` (verificado con `isDate`), `campaignId`, `sheetName`, `rowNumber`, `recipient`, `result`; las claves son exactamente esas más `detail`, y ningún valor contiene el cuerpo, el asunto renderizado, `drive.google.com` ni valores de `First Name` o `Reference`.
  - D-15: `setTemplate` entre fases (cambio de asunto) → cancelación total sin envíos ni escrituras.
  - Fase B paso 8: `hooks.afterSend` inserta una fila arriba → no se escribe `Email Sent` en otra fila, se registra `REVISAR` y la ejecución se detiene.
  - D-18: `failOn.appendLog` → los envíos continúan, `logErrors > 0` y `formatSendSummary_` lo menciona.
- **Verify**: `node --test` (todo pasa); `node --check` sobre `src/Send.js`, `tests/send.test.js` y `tests/helpers/fakes.js` si cambió; `git diff --check` sin salida.

### Step 5: Adaptadores de Google, menú, diálogos y sidebar

- **Files**: crear `tests/ui.test.js`, `tests/services.test.js`, `src/Services.js`, `src/Ui.js`, `src/Sidebar.html`.
- **Do**:
  1. Tests primero (ver **Test**). En los tests de UI, después de `loadAppsScript()`, se reemplaza el global con `ctx.createServices_ = () => deps` (las declaraciones de función de un script son propiedades del objeto global del contexto `vm`, así que `menuX()` y las funciones de la sidebar las resuelven) y se inyecta un `ui` falso que registra `alert`, `confirm` (respuesta configurable), `prompt` (respuesta configurable o `null`) y `showSidebar`. Para `onOpen` y los adaptadores se pasan globales falsos mínimos (`SpreadsheetApp`, `GmailApp`, `DriveApp`, `LockService`, `MailApp`, `PropertiesService`, `Session`, `Utilities`, `HtmlService`) a `loadAppsScript({ ... })`.
  2. `src/Services.js`: `createServices_()` construye `deps` sobre los servicios de Google según el contrato del plan, sin lógica de negocio: `readSheet` con `getDataRange().getDisplayValues()` e `isRowHiddenByUser` / `isRowHiddenByFilter` por fila (índice 0 = `false`); `readRow` con `getRange(rowNumber, 1, 1, width).getDisplayValues()[0]`; `writeStatus` con `getRange(rowNumber, column + 1).setValue(value)` + `SpreadsheetApp.flush()`; `appendLog` crea `Registro Mail Merge` con `LOG_HEADERS` si falta y hace `appendRow` en ese orden; `showLogSheet` devuelve `false` si no existe; `listDrafts` con `date` como texto ISO; `getTemplate` separa adjuntos comunes e inline con las dos llamadas a `getAttachments`; `send` llama a `GmailApp.sendEmail(to, subject, plainBody, options)` omitiendo `replyTo` si es `''` y `from` si es la cuenta propia; `getAttachment` exporta nativos con `getAs('application/pdf')` y nombre `${name}.pdf`; `lock` sobre `LockService.getDocumentLock()` con `tryLock` / `releaseLock`; `props.getConfig()` convierte `sheetId` a `Number` (o `null`); `ids.newCampaignId()` = `Utilities.getUuid().slice(0, 8)`.
  3. `src/Ui.js`: `onOpen`, `menuConfigure`, `menuValidate`, `menuTestSend`, `menuSendPending`, `menuShowLog`, `getConfigOptions`, `saveConfig`, `runValidate_`, `runTestSendFromUi_`, `runSendPending_`, `createUi_` según "Detalle del código > Ui.js". Textos de menú y diálogos en español; la confirmación incluye la revisión por fila de `formatRowReview_` (D-23) y `Se enviarán N correos reales. Esta acción no se puede deshacer.`; el `prompt` de fila acepta solo un entero ≥ 2 (si no, `alert` de error sin llamar a `runTestSend_`); `menuConfigure` muestra la sidebar con `HtmlService.createHtmlOutputFromFile('Sidebar')`. `saveConfig` lanza `Error` con mensaje en español ante pestaña inexistente o de registro, `sheetId` no numérico, borrador ajeno, remitente no autorizado o Reply-To inválido.
  4. `src/Sidebar.html`: formulario con tres `select` (pestaña, borrador como `asunto — fecha`, remitente), `input` de Reply-To, botones `Guardar` y `Cerrar` y área de mensajes; carga con `google.script.run.withSuccessHandler(...).withFailureHandler(...).getConfigOptions()`, guarda con `saveConfig` y preselecciona `current`; todas las opciones y mensajes con `textContent` / `new Option(text, value)`, sin `innerHTML` con datos.
- **Test**:
  - `tests/ui.test.js`:
    - `onOpen` agrega el menú `Mail Merge` con los cinco ítems y sus funciones; no llama a ningún servicio de datos.
    - AC-27: `runValidate_` → un `alert`, cero `send`, cero `writeStatus`, cero `appendLog`.
    - AC-17: `runSendPending_` con `confirm` → `false` → cero `send` y cero `writeStatus`; con `true` → envía y muestra `formatSendSummary_`; el texto de `confirm` contiene la advertencia, la cantidad de filas y la revisión por fila (destinatario y nombres de adjuntos, D-23); el `alert` de `runValidate_` también la contiene.
    - `runSendPending_` sin filas válidas o con errores globales → solo el `alert` del informe, sin `confirm`.
    - `runTestSendFromUi_`: `prompt` `null`, `abc` y `1` → sin `send`; `2` → un `send` de prueba y `alert` con el resultado.
    - `menuShowLog` con `showLogSheet() === false` → `alert` con `Todavía no hay registro.`.
    - Sidebar: `getConfigOptions` excluye `Registro Mail Merge`, devuelve `senders = [userEmail, ...aliases]` y fechas de borradores como texto; `saveConfig({ sheetId: '101', ... })` guarda `sheetId` numérico; rechaza pestaña inexistente, `sheetId: 'x'`, la pestaña de registro, borrador ajeno, alias no autorizado y Reply-To inválido (R-02, R-04) sin llamar a `setConfig`.
    - `src/Sidebar.html` no contiene `innerHTML`.
  - `tests/services.test.js` (con globales falsos):
    - `props.getConfig()` devuelve `sheetId` numérico, y `null` si falta.
    - `gmail.send` omite `replyTo` vacío y `from` igual a la cuenta propia, y pasa ambos cuando corresponden.
    - `lock.release()` llama a `releaseLock()`; `writeStatus` usa la columna `column + 1` y llama a `flush`.
    - `drive.getAttachment` de un nativo usa `getAs('application/pdf')` y nombre `.pdf`; `listDrafts` devuelve `date` como texto ISO.
- **Verify**: `node --test` (todo pasa, incluido `tests/manifest.test.js`, que ahora revisa también `Services.js`, `Ui.js` y `Sidebar.html`); `node --check` sobre `src/Services.js`, `src/Ui.js`, `tests/ui.test.js`, `tests/services.test.js`; `git diff --check` sin salida.

### Step 6: Guías de operación, estado de aceptación y verificación final

- **Files**: crear `docs/OPERATIONS.md` y `docs/ACCEPTANCE_STATUS.md`; modificar `README.md` (solo agregar enlaces a las dos guías).
- **Do**:
  1. `docs/OPERATIONS.md` (español): uso del menú (configurar, validar, probar, enviar pendientes, ver registro); significado de cada estado (`SKIP`; `Email Sent` = aceptado por Gmail, no entregado (D-13); `ENVIANDO`; `REVISAR`); reconciliación manual de `ENVIANDO` / `REVISAR` revisando Enviados en Gmail; casilla de prueba = cuenta propia (D-06); exclusión de filas con `Scheduled Date` (D-03); fórmulas volátiles que hacen omitir filas siempre; límites configurables de `Config.js` (D-11, D-21); revisión por fila antes de confirmar (D-23: el operador debe verificar destinatario y adjuntos); checklist `PENDING LIVE VALIDATION` cuyo primer ítem es la autorización explícita de los scopes amplios `https://mail.google.com/` y `drive.readonly` (D-24: riesgo aceptado solo para desarrollo local), seguido de los ítems de la sección "Pendiente de validación en vivo" más los ítems OPEN del registro de due diligence (`timeZone: Etc/UTC`, scopes más acotados que `https://mail.google.com/`); pasos de una futura activación manual con `clasp`, descritos y no ejecutados.
  2. Ejecutar `node --test` y registrar el resumen real (cantidad de tests, pass/fail).
  3. `docs/ACCEPTANCE_STATUS.md` (español): tabla AC-01 a AC-30 más AC-31 (D-03) con estado `PASS (local mock)`, `FAIL` o `PENDING LIVE VALIDATION`, y el archivo y título del test que lo cubre (buscar los IDs en los títulos de `tests/*.test.js`); AC-29 con la salida de `git remote -v` (vacía) y de `git status --short`; AC-30 con el comando offline usado y su resumen; nivel alcanzado `LOCAL_VERIFIED`, nunca `LIVE_VERIFIED`; lista de verificaciones en vivo pendientes, encabezada por la autorización de scopes (D-24).
  4. `README.md`: agregar una sección corta con enlaces a `docs/OPERATIONS.md` y `docs/ACCEPTANCE_STATUS.md`, sin reescribir el resto.
- **Test**: sin tests nuevos salvo un hueco detectado; la tabla de aceptación debe reflejar los tests existentes y ningún AC automatizable puede quedar sin test asociado (si falta alguno, agregar el test en el archivo correspondiente antes de marcarlo `PASS (local mock)`).
- **Verify**: `node --test` (todo pasa, sin red ni credenciales); `node --check` sobre cada `src/*.js` y `tests/**/*.js`; `git diff --check` sin salida; `git remote -v` vacío; `git status --short` sin archivos inesperados; revisión manual de `src/appsscript.json` contra la lista de scopes.
