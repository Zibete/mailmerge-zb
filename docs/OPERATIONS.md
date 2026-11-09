# Guía de operación — Mail Merge V1

**Estado:** implementado y verificado **solo en forma local** (`LOCAL_VERIFIED`) con servicios de Google simulados. Nada de esta guía se probó todavía en una cuenta real de Google: todo lo que depende del runtime de Apps Script, de Gmail o de Drive figura como `PENDING LIVE VALIDATION` en la checklist del final. El estado de cada criterio de aceptación está en [`ACCEPTANCE_STATUS.md`](ACCEPTANCE_STATUS.md).

## Qué hace

Envía un correo individual por fila de una pestaña de Google Sheets, a partir de un borrador de Gmail con marcadores `{{Encabezado}}`, con los adjuntos comunes del borrador y los archivos de Drive propios de cada fila. Antes de enviar valida todo, muestra qué archivo va a qué dirección y pide una confirmación explícita. Nunca envía un correo incompleto y nunca reintenta en forma automática un envío dudoso.

## Estructura de la pestaña

- La fila 1 es la de encabezados (D-02). Los encabezados se escriben exactamente así (no se traducen):
  - `Email Address` — **obligatorio**. Una sola dirección por fila; sin CC ni BCC.
  - `Mail Merge Status` — **obligatorio**. La escribe el script; ver "Estados".
  - `File Attachments` — opcional. Enlaces de Drive separados por coma.
  - `Scheduled Date` — opcional. Una fila con valor en esta columna **no se envía** (ver "Filas que nunca se envían").
- Cualquier otra columna se puede usar como marcador en el borrador: `{{First Name}}` toma el valor de la columna `First Name` tal como se ve en la hoja.
- Un encabezado repetido (aun con distinta capitalización o espaciado) o un encabezado obligatorio escrito distinto (`email address`) bloquea toda la campaña: el script no adivina.
- Enlaces aceptados en `File Attachments` (D-09): `https://drive.google.com/file/d/<ID>/…`, `https://drive.google.com/open?id=<ID>`, `https://drive.google.com/uc?id=<ID>…` y `https://docs.google.com/(document|spreadsheets|presentation)/d/<ID>/…`. Cualquier otra forma (otro host, `http://`, un ID suelto, `uc?export=download&id=…`, `/file/u/0/d/…`) bloquea la fila. Un mismo archivo repetido en la celda también la bloquea.
- Documentos, hojas de cálculo y presentaciones de Google se adjuntan exportados a PDF (`<nombre>.pdf`). Formularios, dibujos, carpetas, accesos directos y archivos en la papelera bloquean la fila. El script nunca cambia permisos de Drive: quien ejecuta tiene que poder leer cada archivo.

## Menú `Mail Merge`

El menú aparece al abrir la hoja. Sus cinco ítems:

### 1. `Configurar campaña…`

Abre un panel lateral para elegir:

- **Pestaña** de la campaña (la pestaña `Registro Mail Merge` no se ofrece).
- **Borrador** de Gmail que sirve de plantilla (se muestra como `asunto — fecha`).
- **Remitente**: tu cuenta o uno de sus alias de Gmail.
- **Reply-To** (opcional): una sola dirección válida.

La configuración se guarda **por usuario** (D-08): cada operador configura su propia campaña, con su propio borrador. El servidor vuelve a validar todo al guardar.

### 2. `Validar`

Revisa la campaña **sin enviar ni escribir nada** (ni estado ni registro). Muestra:

- pestaña, asunto del borrador, remitente, Reply-To y cuota diaria disponible;
- cantidad de filas válidas, inválidas (con su motivo) y excluidas (con el motivo de exclusión);
- la **revisión por fila** (D-23): los adjuntos comunes del borrador y, para cada fila que se enviaría, `Fila N → destinatario: archivo1, archivo2` (nombres de Drive, nunca URLs), hasta 20 filas y luego `y N filas más`.

Usalo antes de cada envío y cada vez que cambies la hoja o el borrador.

### 3. `Enviar prueba…`

Pide un número de fila (entero, 2 o mayor) y envía ese correo **a tu propia cuenta** (la que ejecuta el script, D-06; no se puede elegir otra casilla), con el asunto precedido por `[PRUEBA] `. El correo es exactamente el que recibiría el destinatario real: mismo cuerpo, mismas imágenes y mismos adjuntos; solo cambian el destinatario y el prefijo del asunto.

- La prueba no cambia el estado de la fila y se puede hacer con cualquier fila válida, aunque ya esté enviada u oculta (D-07).
- Si la fila tiene un adjunto faltante, un marcador sin valor o cualquier otro error, la prueba **no se envía** y se muestran los motivos.
- Deja una línea `PRUEBA` en el registro.

### 4. `Enviar pendientes…`

1. Valida todo de nuevo (igual que `Validar`). Si no hay filas para enviar o hay errores que afectan a toda la campaña, muestra el informe y termina.
2. Pide confirmación mostrando pestaña, asunto, remitente, Reply-To, cantidad de correos, la revisión por fila y la advertencia `Se enviarán N correos reales. Esta acción no se puede deshacer.`
3. Solo con **Sí** envía. Al momento de enviar vuelve a leer todo desde cero:
   - si cambiaron la plantilla, los encabezados, el remitente o el Reply-To, **cancela todo** sin enviar nada (D-15);
   - si cambió una fila (destinatario, enlaces, cualquier valor), **omite esa fila** como `Cambió después de la confirmación` y sigue con las demás;
   - si otra persona está enviando la misma hoja, espera hasta 10 segundos; si no puede tomar el turno, termina con `Hay otra ejecución en curso; reintentá en unos minutos`.
4. Al terminar muestra un resumen: correos aceptados por Gmail, filas omitidas con su motivo, filas que requieren revisión manual y, si corresponde, el motivo del corte (tiempo, cuota, error).

**Revisión antes de confirmar (D-23).** Cualquier persona con permiso de edición sobre la hoja puede cambiar destinatarios y enlaces. Antes de responder **Sí**, verificá en el diálogo que cada dirección sea la correcta y que los archivos listados sean los que corresponden a esa persona. El diálogo muestra hasta 20 filas; si la campaña tiene más, revisá el resto en la hoja (o con `Validar`) antes de confirmar, o enviá por tandas más chicas.

### 5. `Ver registro`

Activa la pestaña `Registro Mail Merge` (D-17), que se crea con el primer envío o prueba. Si todavía no existe, avisa `Todavía no hay registro.` Columnas: `Fecha`, `Campaña`, `Pestaña`, `Fila`, `Destinatario`, `Resultado`, `Detalle`. El registro nunca guarda el cuerpo, el asunto renderizado, URLs de Drive ni otras columnas de la fila. Un texto que Sheets interpretaría como fórmula (empieza con `=`, `+`, `-` o `@`) se guarda precedido por `'`.

Valores de `Resultado`: `PRUEBA` (envío de prueba), `Email Sent` (aceptado por Gmail), `OMITIDA` (no se envió; el motivo está en `Detalle`), `NO ENVIADA` (falló el claim antes de llamar a Gmail), `ENVIANDO` y `REVISAR` (requieren revisión manual, ver abajo).

Si no se puede escribir el registro, el envío continúa y el resumen final lo avisa (D-18): el estado de la hoja es la fuente de verdad, no el registro.

## Estados de `Mail Merge Status`

Solo una fila con el estado **vacío** se envía. Cualquier otro valor la excluye de los envíos automáticos.

| Estado | Quién lo escribe | Significado |
|---|---|---|
| (vacío) | — | Pendiente: se envía si es válida, visible y sin `Scheduled Date`. |
| `SKIP` | El operador | No enviar esta fila. |
| `Email Sent` | El script | **Gmail aceptó el correo** para enviarlo. No significa que haya sido entregado ni leído (D-13): un rebote o un filtro de spam posteriores no se detectan. |
| `ENVIANDO` | El script | El script reservó la fila justo antes de llamar a Gmail. Si queda así, la ejecución se cortó en el medio y **no se sabe** si el correo salió. |
| `REVISAR` | El script | Gmail devolvió un error o la fila se movió durante el envío: el resultado es **ambiguo**. |
| Cualquier otro valor | — | Fecha, texto, etc.: la fila queda excluida. |

El script no cambia nunca un estado que ya tenía valor y no reintenta solo las filas `ENVIANDO` ni `REVISAR`: un reintento automático podría duplicar un correo que sí salió.

### Reconciliación manual de `ENVIANDO` y `REVISAR`

Para cada fila con `ENVIANDO` o `REVISAR`:

1. Buscá la línea de esa fila en `Registro Mail Merge` (columna `Detalle`) para ver qué pasó. `Gmail aceptó el correo` indica que salió; `no se envió el correo` (resultado `NO ENVIADA`) indica que el script se detuvo antes de llamar a Gmail; una excepción de Gmail es ambigua. Si el registro no tiene la línea (por un corte o una falla del registro), seguí con el paso 2.
2. En Gmail, abrí la carpeta **Enviados** de la cuenta (o del alias) que envió y buscá un correo a esa dirección con ese asunto, a la hora del registro.
3. Si el correo **está** en Enviados: escribí `Email Sent` en `Mail Merge Status`.
4. Si el correo **no está**: vaciá la celda. La fila vuelve a ser pendiente y entra en el próximo `Enviar pendientes…`.
5. Si no podés determinarlo con certeza, escribí `SKIP` y resolvelo fuera de la herramienta.

Atención: si se insertaron o borraron filas durante un envío, el estado `ENVIANDO` puede haber quedado en otra posición (el script se detiene para no escribir en la fila equivocada). Verificá la dirección de la fila antes de corregirla.

## Filas que nunca se envían

- **Filas ocultas**, ya sea a mano o por un filtro (aunque tengan el estado vacío).
- **Filas con `Scheduled Date`** con cualquier valor (D-03). Esta versión no programa envíos: una fila con fecha no se envía nunca antes de tiempo ni en su fecha. Para enviarla, vaciá `Scheduled Date`.
- **Filas con fórmulas volátiles** (`=NOW()`, `=RAND()`, `=RANDBETWEEN()`, o fórmulas que dependan de ellas). El script compara la fila confirmada con la fila al momento de enviar; como esas fórmulas cambian en cada lectura, la fila se omite **siempre** como `Cambió después de la confirmación`. Reemplazá la fórmula por su valor (Copiar → Pegar solo valores) antes de enviar.
- **Filas inválidas**: dirección inválida o con varias direcciones, `Email Address` vacío, marcador sin valor, enlace no aceptado, archivo inexistente o sin acceso, tipo de archivo no soportado, adjuntos o cuerpo demasiado grandes. Aparecen en `Validar` con su motivo y no cambian de estado (D-19).
- **Filas totalmente vacías**: no se cuentan.

## Límites configurables (`src/Config.js`)

Los límites están en la constante `LIMITS` de `src/Config.js` (D-11); no se repiten en la lógica. Cambiarlos requiere publicar de nuevo el código (ver "Activación futura").

| Límite | Valor | Para qué |
|---|---|---|
| `MAX_TOTAL_ATTACHMENT_BYTES` | 20 MB | Tamaño total de adjuntos por correo (comunes + de la fila). Por debajo de los 25 MB de Gmail, con margen para la codificación. Los documentos de Google se miden recién al exportarlos a PDF. |
| `MAX_BODY_BYTES` | 200 KB | Tamaño del HTML más el texto plano renderizados (D-21). Es el menor límite de cuerpo de la página de cuotas (cuentas de consumo; Workspace admite 400 KB). |
| `MAX_RUNTIME_MS` | 270 000 ms (4,5 min) | Presupuesto de tiempo por ejecución, por debajo de los 6 min de Apps Script. Se cuenta desde que se elige `Enviar pendientes…`, **incluido el tiempo del diálogo de confirmación** (D-12). Al alcanzarlo, el envío se detiene y las filas restantes siguen pendientes. |
| `LOCK_WAIT_MS` | 10 000 ms | Espera máxima por otra ejecución en curso sobre la misma hoja. |

La cuota diaria de envíos de Gmail se consulta en cada validación. Si se agota durante el envío, el script se detiene y las filas restantes siguen pendientes para otro día. Si la cuota no se puede leer al momento de enviar, no se envía nada.

## Checklist `PENDING LIVE VALIDATION`

Nada de esto se puede comprobar localmente. Antes de cualquier uso real, cada ítem requiere una verificación en vivo, autorizada y en un entorno de prueba (hoja de prueba, cuenta de prueba, destinatarios de prueba):

1. **Autorización explícita de los scopes amplios (D-24).** `https://mail.google.com/` (acceso completo al buzón) y `https://www.googleapis.com/auth/drive.readonly` (lectura de todo el Drive) son scopes amplios y restringidos por Google. Se aceptaron como riesgo **solo para el desarrollo local**, donde no se otorgan ni se ejercen. Antes de cualquier uso real: revisar la pantalla de consentimiento, la política de Workspace de la organización y obtener la autorización explícita del responsable.
2. Comportamiento real de `Ui.alert` (suspensión del script durante el diálogo) y de `LockService` en el runtime.
3. Scopes efectivos que pide el proyecto y pantalla de consentimiento real, contra la lista de `src/appsscript.json`.
4. Alias reales de Gmail como remitente (`from`) y Reply-To real.
5. Cuota diaria real de la cuenta (`MailApp.getRemainingDailyQuota()`).
6. Aspecto del HTML, imágenes inline (emparejadas por el `alt` de la imagen contra su nombre) y firma, en una casilla de prueba.
7. Exportación a PDF de documentos, hojas y presentaciones nativas, y tamaños reales frente a `MAX_TOTAL_ATTACHMENT_BYTES`.
8. Detección de filas ocultas por filtro y ocultas a mano en una hoja real.
9. Tiempos reales por fila frente a `MAX_RUNTIME_MS`, incluido el costo de leer las filas ocultas (dos llamadas al servicio por fila) en hojas grandes.
10. Formatos reales de los enlaces de Drive que usan los operadores frente a los formatos aceptados (D-09).
11. **OPEN (due diligence):** que Apps Script acepte `"timeZone": "Etc/UTC"` en el manifest (la documentación pide un ZoneId sin enumerar los valores aceptados).
12. **OPEN (due diligence):** si existe una combinación de scopes más acotados que `https://mail.google.com/` que alcance para leer borradores y alias y enviar con `GmailApp`. En V1 no se exploró (D-24).

## Activación futura con `clasp` (descripta, no ejecutada)

Estos pasos **no se ejecutaron** y no forman parte del desarrollo local. Requieren la autorización del punto 1 de la checklist, una hoja de prueba y una cuenta de prueba. Confirmá la sintaxis de cada comando contra la documentación vigente de `clasp` en el momento de usarlo.

1. Obtener la autorización explícita de los scopes (D-24) y definir la hoja y la cuenta de prueba.
2. Instalar `clasp` en la máquina del operador autorizado (`npm install -g @google/clasp`) y habilitar la Apps Script API en la configuración de usuario de Apps Script de esa cuenta.
3. `clasp login` con la cuenta de prueba.
4. Crear el proyecto vinculado a la hoja de prueba con `rootDir` en `src/` (por ejemplo `clasp create --type sheets --title "Mail Merge" --rootDir src`), o vincular uno existente con `clasp clone <scriptId> --rootDir src`.
5. Verificar que `.clasp.json` y `.clasprc.json` **no** queden en Git (ya están en `.gitignore`): contienen el ID del script y credenciales locales.
6. `clasp push` para subir `src/` (incluido `appsscript.json`).
7. Abrir la hoja de prueba, recargarla, elegir un ítem del menú `Mail Merge` y revisar la pantalla de consentimiento contra la lista de scopes.
8. Recorrer la checklist `PENDING LIVE VALIDATION` con destinatarios de prueba, empezando por `Validar` y `Enviar prueba…`.
9. Registrar los resultados y recién entonces decidir, con aprobación escrita, un primer uso real.

Alternativa sin `clasp`: en la hoja de prueba, `Extensiones → Apps Script`, crear un archivo por cada `src/*.js` y `src/Sidebar.html` con el mismo nombre, y reemplazar el manifest `appsscript.json` (visible activando "Mostrar el archivo de manifiesto" en la configuración del proyecto).
