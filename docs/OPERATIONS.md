# Guía de operación — Mail Merge V2

**Estado:** implementado y verificado **solo en forma local** (`LOCAL_VERIFIED`) con servicios de Google simulados. Nada de esta guía se probó todavía en una cuenta real de Google: todo lo que depende del runtime de Apps Script, de Gmail o de Drive figura como `PENDING LIVE VALIDATION` en la checklist del final. El estado de cada criterio de aceptación está en [`ACCEPTANCE_STATUS.md`](ACCEPTANCE_STATUS.md); el diseño, en `plans/2026-11-09_mail-merge-v2.md`.

## Qué hace

Envía un correo individual por fila de una pestaña de Google Sheets, a partir de un borrador de Gmail con marcadores `{{Encabezado}}`, con los adjuntos comunes del borrador y los archivos de Drive propios de cada fila. Todo se maneja desde un **panel lateral** (sidebar): configuración, validación, preparación de columnas, prueba, confirmación, progreso y resultados. Antes de enviar valida todo, muestra qué archivo va a qué dirección y pide una confirmación explícita. El resultado de cada fila queda en la misma pestaña, en las columnas `Resultado` y `Detalle`. Nunca envía un correo incompleto y nunca reintenta en forma automática un envío dudoso.

## Estructura de la pestaña

La fila 1 es la de encabezados (D-02). Los encabezados se escriben exactamente así (no se traducen):

| Encabezado | Obligatorio | Quién lo escribe | Para qué |
|---|---|---|---|
| `Email Address` | Sí | El operador | Una sola dirección por fila; sin CC ni BCC. |
| `File Attachments` | No | El operador | Enlaces de Drive separados por coma. |
| `Resultado` | Sí (columna gestionada) | El script y el operador | Estado de la fila: decide si se envía. Ver "Estados de `Resultado`". |
| `Fecha` | Sí (columna gestionada) | El script | Momento en que se inició el envío de la fila. |
| `Campaña` | Sí (columna gestionada) | El script | Nombre de la campaña o el ID generado para ese envío (D-39). |
| `Detalle` | Sí (columna gestionada) | El script | Motivo resumido del resultado, en una línea. |

- Las cuatro columnas gestionadas (`Fecha`, `Campaña`, `Resultado`, `Detalle`, D-31) son obligatorias para validar y enviar. Si faltan, el panel ofrece **"Preparar columnas"** (ver abajo).
- `Mail Merge Status` y `Scheduled Date` son **encabezados heredados** de la V1: solo los reconoce "Preparar columnas". Mientras la pestaña tenga alguno, la validación falla con `La pestaña tiene encabezados de la versión anterior; usá "Preparar columnas"`.
- Cualquier otra columna se puede usar como marcador en el borrador: `{{First Name}}` toma el valor de la columna `First Name` tal como se ve en la hoja. Las columnas gestionadas **no** se pueden usar como marcador (`{{Fecha}}`, `{{Resultado}}`, etc. son un error que bloquea toda la campaña, D-35), porque el script las cambia durante el envío.
- Un encabezado repetido (aun con distinta capitalización o espaciado) o un encabezado conocido escrito distinto (`email address`, `resultado`, un `Campaña` con la `ñ` descompuesta) bloquea toda la campaña: el script no adivina.
- Enlaces aceptados en `File Attachments` (D-09): `https://drive.google.com/file/d/<ID>/…`, `https://drive.google.com/open?id=<ID>`, `https://drive.google.com/uc?id=<ID>…` y `https://docs.google.com/(document|spreadsheets|presentation)/d/<ID>/…`. Cualquier otra forma (otro host, `http://`, un ID suelto, `uc?export=download&id=…`, `/file/u/0/d/…`) bloquea la fila. Un mismo archivo repetido en la celda también la bloquea.
- Documentos, hojas de cálculo y presentaciones de Google se adjuntan exportados a PDF (`<nombre>.pdf`). Formularios, dibujos, carpetas, accesos directos y archivos en la papelera bloquean la fila. El script nunca cambia permisos de Drive: quien ejecuta tiene que poder leer cada archivo.
- La pestaña `Registro Mail Merge` de la V1, si existe, **no se escribe, no se borra** y no se ofrece como pestaña de campaña (D-32). Conserva el historial de los envíos hechos con la V1; sus datos no se copian a las filas.

## El panel `Mail Merge`

El menú `Mail Merge` tiene un solo ítem, **`Abrir Mail Merge`** (D-25), que abre el panel lateral (300 px de ancho). Ya no hay diálogos emergentes: todo se ve y se confirma en el panel. Sus secciones, de arriba hacia abajo:

### 1. Campaña

- **Pestaña de la campaña** (la pestaña `Registro Mail Merge` no se ofrece).
- **Borrador de Gmail (plantilla)** (se muestra como `asunto — fecha`).
- **Remitente**: tu cuenta o uno de sus alias de Gmail.
- **Reply-To (opcional)**: una sola dirección válida.
- **Nombre de campaña (opcional)**: hasta 80 caracteres; se guarda sin saltos de línea ni tabulaciones y recortado. Si lo dejás vacío, cada confirmación (cada envío y cada prueba) genera un ID de 8 caracteres, distinto en cada una, que se muestra en la confirmación y se escribe en `Campaña` de todas las filas de esa ejecución (D-39). Si querés agrupar varias tandas bajo un mismo nombre, escribilo.

El botón `Guardar` vuelve a validar todo en el servidor. La configuración se guarda **por usuario** (D-08): cada operador configura su propia campaña, con su propio borrador. Una configuración guardada con la V1 sigue funcionando (sin nombre de campaña).

### 2. Validación

El botón `Validar` revisa la campaña **sin enviar ni escribir nada**: ni en la hoja ni en la caché (AC-33). Muestra:

- pestaña, asunto del borrador, remitente, Reply-To y cuota diaria disponible;
- cantidad de filas válidas, inválidas (con sus motivos) y excluidas (con el motivo de exclusión);
- los adjuntos comunes del borrador y **todas** las filas que se enviarían, `Fila N → destinatario: archivo1, archivo2` (nombres de Drive, nunca URLs), hasta 500 filas y luego `y N filas más` (D-42);
- un aviso, sin casilla, si alguna fila a enviar ya tiene valores en `Fecha`, `Campaña` o `Detalle` que se reemplazarían (D-47; la confirmación pedirá tu consentimiento);
- si la pestaña necesita preparar sus columnas, qué se renombra, qué se agrega, los bloqueos y el botón `Preparar columnas`.

Usalo antes de cada envío y cada vez que cambies la hoja o el borrador.

### 3. Prueba

Indicás la fila a probar y `Revisar prueba` prepara una confirmación para esa sola fila; `Enviar prueba` la envía y `Cancelar` la descarta. Ver "Envío de prueba".

### 4. Envío

`Revisar envío` prepara la confirmación de todas las filas pendientes; `Enviar N correos` envía y `Cancelar` la descarta. Ver "Envío real".

### 5. Progreso y resultados

Contadores, barra de progreso, tabla por fila (`Fila`, `Destinatario`, `Resultado`, `Detalle`), motivo de corte y resumen final. Ver "Progreso y resultados".

El botón `Cerrar` cierra el panel.

## Preparar columnas

Cuando la pestaña todavía tiene encabezados de la V1 o le falta alguna columna gestionada, la validación devuelve un error global y un **plan de columnas**. El botón `Preparar columnas` aplica ese plan y vuelve a validar. Validar nunca cambia la hoja: solo "Preparar columnas" lo hace, y solo en la fila 1 (D-33).

Qué hace:

1. **Renombra en el lugar** la celda de encabezado `Mail Merge Status` → `Resultado` y `Scheduled Date` → `Fecha`. Los datos de esas columnas no se mueven ni se modifican.
2. **Agrega las columnas gestionadas que falten**, en el orden `Resultado`, `Fecha`, `Campaña`, `Detalle`, a partir de la primera columna a la derecha de la última columna con contenido en **cualquier** fila (también una columna con datos y sin encabezado). Si la hoja no tiene suficientes columnas, las inserta al final. Nunca escribe sobre columnas existentes ni las desplaza.
3. Escribe primero la celda `Resultado` (renombrada o agregada) y después el resto (`Scheduled Date` → `Fecha` y los demás agregados). Así, si la operación se corta a mitad, la pestaña ya tiene `Resultado` y se puede volver a ejecutar sin caer en los bloqueos de abajo.

Garantías:

- Corre bajo el mismo lock que el envío; si otra ejecución lo tiene, responde `Hay otra ejecución en curso; reintentá en unos minutos` sin escribir.
- Compara la fila de encabezados con la que viste al validar (compare-and-set): si cambió, responde `La fila de encabezados cambió; volvé a validar` sin escribir.
- Es idempotente: una segunda ejecución no cambia nada. Si una escritura falla (por ejemplo, por un rango protegido en la fila 1), responde `No se pudieron preparar todas las columnas; revisá la fila 1 y volvé a intentar (la operación se puede repetir)`; al repetirla completa lo que falta.
- Después de preparar, cualquier confirmación preparada antes queda inválida (cambiaron los encabezados) y el envío se cancela sin enviar.

### Bloqueos (D-34) y cómo resolverlos a mano

Si se da alguno de estos casos, "Preparar columnas" **no escribe nada** y el panel lista el motivo; el botón queda deshabilitado hasta que lo resuelvas en la hoja y vuelvas a validar. Las filas ocultas también cuentan. Cuando el error lista filas, muestra hasta 20 y luego `y N filas más`.

| Caso | Qué significa | Cómo resolverlo |
|---|---|---|
| **(a)** Conviven `Mail Merge Status` y `Resultado`, o `Scheduled Date` y `Fecha` | No se sabe cuál de las dos es la columna de estado o de fecha | Dejá una sola de las dos columnas (pasá los datos que quieras conservar y borrá o renombrá la otra) y volvé a validar. |
| **(b)** La pestaña todavía tiene `Mail Merge Status` y ya tiene una columna `Fecha`, `Campaña` o `Detalle` que no viene del renombre | Es una columna propia del operador, que Mail Merge escribiría | Renombrá tu columna (por ejemplo `Fecha original`, `Campaña original`, `Detalle original`) y, si el borrador la usa como marcador, actualizá el marcador (`{{Fecha original}}`). Volvé a validar. |
| **(c)** Hay filas con `Scheduled Date` con valor y la columna de estado vacía (`Mail Merge Status`, o `Resultado` si ese renombre ya se aplicó) | En la V1 una fecha programada excluía la fila; en la V2 solo `Resultado` decide, así que al migrar esas filas pasarían a ser enviables | Para cada fila listada: vaciá `Scheduled Date` si querés enviarla, o escribí `SKIP` en la columna de estado si no. Volvé a validar. |
| **(d)** La pestaña no tiene encabezados heredados ni `Resultado`, pero ya tiene `Fecha`, `Campaña` o `Detalle` | Es una columna propia del operador (una preparación interrumpida nunca deja esas columnas sin `Resultado`) | Renombrá tu columna como en (b), actualizando el borrador si la usa, y volvé a validar. |
| **(e)** La pestaña no tiene encabezados heredados, ya tiene `Resultado`, le falta alguna columna gestionada y alguna de `Fecha`, `Campaña` o `Detalle` tiene valor en una fila con `Resultado` vacío | Mail Merge reemplazaría esos valores al enviar esas filas | El error nombra la columna y las filas. Renombrá la columna como en (b) o, si esas celdas no tienen datos que conservar, vacialas. Volvé a validar. |

Si las columnas `Fecha`, `Campaña` o `Detalle` existentes solo tienen valores en filas con `Resultado` no vacío, no hay bloqueo: se adoptan como gestionadas (esas filas nunca se escriben mientras `Resultado` tenga valor) y se agregan las que faltan.

Una pestaña que ya tiene las cuatro columnas gestionadas no necesita preparación ni se bloquea, aunque alguna de esas columnas sea en realidad tuya: el script no puede distinguirlas. Ese caso lo cubre la casilla de consentimiento (ver "Consentimiento para reemplazar `Fecha`, `Campaña` o `Detalle`"). **Si tenés columnas propias llamadas `Fecha`, `Campaña` o `Detalle`, renombralas antes de preparar o de enviar.**

## Envío de prueba

1. En la sección **Prueba**, indicá el número de fila (entero, 2 o mayor) y elegí `Revisar prueba`.
2. Solo se puede probar una fila **elegible y válida** (D-40): visible, con `Resultado` vacío y sin errores. Una fila oculta, con `Resultado` con cualquier valor, inválida (con sus motivos), vacía, la fila 1 o fuera de rango se rechaza sin preparar nada.
3. La confirmación muestra el destinatario de la prueba (tu propia cuenta, D-06; no se puede elegir otra casilla), la fila con sus adjuntos y la advertencia: `Se enviará 1 correo a tu cuenta (<cuenta>) con el asunto precedido por [PRUEBA]. La fila N quedará con Resultado = Email Sent y no se enviará al destinatario real hasta que borres ese resultado.`
4. `Enviar prueba` envía el correo con el mismo motor que el envío real (lock, revalidación, `ENVIANDO`, Gmail, verificación). El correo es exactamente el que recibiría el destinatario real (mismo cuerpo, imágenes y adjuntos); solo cambian el destinatario y el prefijo `[PRUEBA] ` del asunto.

> **Importante: la prueba deja `Resultado = Email Sent`.** La fila queda con `Fecha`, `Campaña` y `Detalle = PRUEBA enviada a tu cuenta (<cuenta>); el destinatario real no recibió este correo. Para enviárselo, borrá Resultado`. **El destinatario real no recibe nada** hasta que borres a mano el valor de `Resultado` de esa fila: mientras tenga `Email Sent`, `Enviar N correos` la excluye como cualquier otra fila con resultado.

Para enviarle el correo real al destinatario después de la prueba:

1. Vaciá la celda `Resultado` de esa fila (dejala en blanco; no escribas nada).
2. Elegí `Revisar envío`: la fila vuelve a aparecer entre las que se envían.
3. Como esa fila ya tiene `Fecha`, `Campaña` y `Detalle` de la prueba, la confirmación pide marcar la casilla de consentimiento para reemplazarlos. Marcala y confirmá.

Para repetir una prueba sobre la misma fila, también hay que vaciar antes su `Resultado`. Si Gmail rechaza la prueba con una excepción, la fila queda `REVISAR` igual que en un envío real.

## Envío real

1. En la sección **Envío**, elegí `Revisar envío`. El servidor valida todo de nuevo. Si no hay filas para enviar (`No hay correos para enviar`), si hay errores que afectan a toda la campaña o si hay más de 500 filas, no se prepara nada.
2. La confirmación muestra campaña (nombre o ID generado), pestaña, asunto, remitente, Reply-To, cantidad de correos, los adjuntos comunes, **todas** las filas a enviar con destinatario y adjuntos, la cantidad de filas inválidas y excluidas, la hora en que vence la confirmación (10 minutos) y la advertencia `Se enviarán N correos reales. Esta acción no se puede deshacer.`
3. Si alguna fila a enviar ya tiene valores en `Fecha`, `Campaña` o `Detalle`, aparece la casilla de consentimiento y `Enviar N correos` queda deshabilitado hasta marcarla.
4. Un solo clic en `Enviar N correos` envía; el botón se deshabilita desde el primer clic y el panel no vuelve a llamar al servidor por su cuenta (D-45). `Cancelar` descarta la confirmación sin enviar nada. Pasados los 10 minutos el botón se deshabilita y hay que volver a `Revisar envío`.

**Revisión antes de confirmar (D-42).** Cualquier persona con permiso de edición sobre la hoja puede cambiar destinatarios y enlaces. Antes de confirmar, verificá en el panel que cada dirección sea la correcta y que los archivos listados sean los que corresponden a esa persona. El panel lista todas las filas (hasta 500); desplazate hasta el final antes de confirmar.

Al enviar, el servidor vuelve a leer todo desde cero:

- si cambiaron la plantilla, los encabezados, el remitente o el Reply-To, **cancela todo** sin enviar nada (D-15);
- si cambió la configuración guardada (pestaña, borrador, remitente, Reply-To o nombre de campaña, por ejemplo desde otra pestaña del navegador), **cancela todo** sin enviar nada (D-43);
- si cambió una fila (destinatario, enlaces, `Resultado` o cualquier otro valor), **omite esa fila** como `Cambió después de la confirmación` y sigue con las demás;
- si cambiaron `Fecha`, `Campaña` o `Detalle` de una fila después de confirmar, **omite esa fila** sin escribir nada en ella (ver D-48 abajo) y sigue con las demás;
- si otra persona está enviando o preparando columnas en la misma hoja, espera hasta 10 segundos; si no puede tomar el turno, termina con `Hay otra ejecución en curso; reintentá en unos minutos`.

### Envíos rechazados antes de empezar

Si el servidor rechaza la ejecución antes de enviar (lock no disponible, falta el consentimiento, cambió la configuración o la plantilla, la confirmación venció o no es válida), **no se envía nada ni se escribe nada en la hoja**. El panel muestra el motivo, vuelve al estado inicial y descarta la confirmación: para enviar hay que volver a `Revisar envío` (o `Revisar prueba`). La confirmación es de un solo uso: en casi todos esos casos el servidor ya la consumió; cuando el lock no estaba disponible queda sin consumir en la caché del usuario hasta que vence (como mucho 10 minutos), pero el panel ya no la usa. Lo mismo pasa si `Cancelar` no llega al servidor: el panel avisa `Confirmación descartada; no se envió nada y vence sola en 10 minutos.`

### Consentimiento para reemplazar `Fecha`, `Campaña` o `Detalle` (D-47)

En una pestaña completa, el script no puede distinguir una columna `Fecha`, `Campaña` o `Detalle` gestionada (con datos de una prueba o de un envío anterior) de una columna propia del operador con ese nombre. Por eso, antes de reemplazar valores existentes pide un consentimiento explícito:

- La validación y la confirmación (envío y prueba) identifican cada fila a enviar que ya tiene valor en alguna de esas tres columnas, y cuáles columnas. **Nunca muestran los valores.**
- Si hay alguna, la confirmación muestra una casilla, **sin marcar**, con el texto `Acepto que se reemplacen los valores existentes de Fecha, Campaña o Detalle en N filas: fila 2 (Fecha, Detalle), fila 5 (Campaña)`, que lista las columnas por fila (hasta 20 filas y luego `y N filas más`, con el total).
- El botón de envío queda deshabilitado mientras la casilla no esté marcada. Una confirmación nueva vuelve a mostrar la casilla sin marcar.
- El servidor también lo exige: si hay filas a reemplazar y la llamada no trae el consentimiento, rechaza sin enviar ni escribir con `Falta el consentimiento para reemplazar Fecha, Campaña o Detalle; volvé a revisar y confirmar`. Si no hay filas a reemplazar, no se pide casilla.

El caso normal es el envío real después de una prueba (la fila tiene `Fecha`, `Campaña` y `Detalle` de la prueba).

**Riesgo residual.** En una pestaña completa con columnas propias llamadas `Fecha`, `Campaña` o `Detalle`, marcar la casilla sin leerla **reemplaza esos valores** en las filas que se envían, y no se pueden recuperar desde la herramienta (solo desde el historial de versiones de la hoja). Leé la lista de filas y columnas antes de marcar, y renombrá las columnas propias antes de usar la herramienta (ver "Bloqueos").

### Cambios en `Fecha`, `Campaña` o `Detalle` después de confirmar (D-48)

La confirmación recuerda una huella de `Fecha`, `Campaña` y `Detalle` de cada fila (sin guardar los valores). Si alguien los edita entre la confirmación y el envío de esa fila (por ejemplo, completa un `Detalle` que estaba vacío), el consentimiento ya no cubre esos datos: la fila se omite como `OMITIDA` con el motivo `Fecha, Campaña o Detalle cambiaron después de la confirmación; la fila no se modificó`, **sin ninguna escritura** en ella, y las demás filas se envían. Para enviarla, volvé a `Revisar envío`.

Editar esas tres columnas a mano **no** cambia la elegibilidad de la fila (solo `Resultado` decide); editar cualquier otra columna, incluido `Resultado`, hace que la fila se omita como `Cambió después de la confirmación`.

## Progreso y resultados

Mientras el servidor envía, el panel consulta el progreso cada 2 segundos (una consulta por vez) y actualiza:

| Contador | Qué cuenta |
|---|---|
| `Total` | Filas confirmadas. |
| `Procesadas` | Filas que ya terminaron, con cualquier resultado. |
| `Aceptadas por Gmail` | Cada correo que Gmail aceptó, **incluidas** las filas que después quedaron para revisar (por ejemplo, si la fila se desplazó o no se pudo escribir `Email Sent`). |
| `Omitidas` | Filas `OMITIDA`: no se enviaron ni se modificaron. |
| `Para revisar` | Filas con resultado `NO ENVIADA`, `ENVIANDO` o `REVISAR`. |
| `Pendientes` | `Total` − `Procesadas`: filas que esta ejecución no llegó a procesar; siguen elegibles. |

Por eso `Aceptadas por Gmail` + `Omitidas` + `Para revisar` puede superar `Procesadas`: una fila aceptada por Gmail que después quedó para revisar cuenta en los dos contadores (el panel lo aclara debajo de los contadores).

Resultados por fila en la tabla:

| Resultado | Significado | ¿Se escribe en la hoja? |
|---|---|---|
| `Email Sent` | Gmail aceptó el correo y la fila sigue en su lugar | Sí: `Detalle = Aceptado por Gmail` (o el texto de la prueba) y `Resultado = Email Sent` |
| `OMITIDA` | No se envió: la fila cambió, sus metadatos cambiaron o falló al armar el mensaje (motivo en `Detalle` del panel) | No |
| `NO ENVIADA` | No se pudo marcar `ENVIANDO` y no se llamó a Gmail; la ejecución se detuvo | No (revisá `Resultado` de la fila) |
| `ENVIANDO` | Gmail aceptó pero no se pudo escribir `Email Sent`, o hubo una excepción y no se pudo escribir `REVISAR` | La fila quedó `ENVIANDO` |
| `REVISAR` | Gmail lanzó una excepción (la ejecución se detuvo), o la fila se desplazó después de que Gmail aceptó | Excepción: `Detalle` y `Resultado = REVISAR`. Fila desplazada: no se escribe; la fila quedó `ENVIANDO` |

Durante el envío, la columna `Destinatario` sale de la confirmación que tiene el panel (el progreso en caché no guarda direcciones, D-46). Al terminar, el panel muestra la tabla final, el motivo de corte (tiempo, cuota, error) y un resumen: correos **aceptados por Gmail** (nunca "entregados", D-13), filas procesadas, omitidas, para revisión y pendientes. Si el progreso tuvo que recortar filas para entrar en la caché, el panel lo avisa; el resultado final siempre trae todas las filas.

Si el panel no recibe respuesta del servidor (falla de transporte), muestra el último progreso conocido y la guía `No se pudo confirmar el resultado. Revisá la columna Resultado (ENVIANDO / REVISAR) antes de volver a enviar`. No reintenta: para volver a enviar hay que preparar una confirmación nueva, después de revisar la hoja.

### Panel cerrado durante el envío

Si cerrás el panel (o la pestaña del navegador) mientras se envía, la ejecución del servidor **sigue** hasta terminar o cortar; el resultado queda en `Resultado` y `Detalle` de cada fila. Al reabrir el panel, el progreso no se recupera (el panel no guarda la confirmación). Revisá la hoja: las filas `Email Sent` salieron, las vacías siguen pendientes y las `ENVIANDO` / `REVISAR` requieren conciliación. Antes de volver a enviar, esperá unos minutos para que termine la ejecución anterior (mientras tanto, un envío nuevo responde `Hay otra ejecución en curso`).

## Qué escribe el script en cada fila (D-37, D-38)

| Momento | Escrituras, en este orden |
|---|---|
| Antes de llamar a Gmail (claim) | `Fecha` = fecha y hora actuales, `Campaña` = nombre o ID, `Detalle = Envío iniciado; si Resultado sigue en ENVIANDO, revisá la carpeta Enviados`, `Resultado = ENVIANDO` |
| Gmail aceptó y la fila sigue en su lugar | `Detalle` (texto de éxito), `Resultado = Email Sent` |
| Gmail lanzó una excepción | `Detalle` (motivo resumido), `Resultado = REVISAR` |
| Fila omitida, claim fallido o fila desplazada | Nada |

- `Resultado` se escribe **siempre último**: si la ejecución se corta en medio de una transición, `Resultado` conserva el valor anterior seguro (vacío antes del claim, `ENVIANDO` después).
- El script solo escribe en filas con `Resultado` vacío al confirmar y nunca cambia un `Resultado` que ya tenía valor.
- Un texto que Sheets interpretaría como fórmula (empieza con `=`, `+`, `-` o `@`) se escribe precedido por `'`. `Detalle` va en una línea, sin URLs y con hasta 300 caracteres. Nunca se escribe el cuerpo, el asunto renderizado, URLs ni valores de otras columnas.
- `Fecha` se escribe como fecha; la hoja la muestra con su propio formato y zona horaria (D-20).

## Estados de `Resultado`

Solo una fila con `Resultado` **vacío** se envía. Cualquier otro valor la excluye del envío y de la prueba.

| Estado | Quién lo escribe | Significado |
|---|---|---|
| (vacío) | — | Pendiente: se envía si es válida y visible. |
| `SKIP` | El operador | No enviar esta fila. |
| `Email Sent` | El script | **Gmail aceptó el correo** para enviarlo. No significa que haya sido entregado ni leído (D-13): un rebote o un filtro de spam posteriores no se detectan. Después de una prueba, el correo fue a tu cuenta, no al destinatario real (ver `Detalle`). |
| `ENVIANDO` | El script | El script reservó la fila justo antes de llamar a Gmail. Si queda así, la ejecución se cortó en el medio y **no se sabe** si el correo salió. |
| `REVISAR` | El script | Gmail devolvió un error: el resultado es **ambiguo**. |
| Cualquier otro valor | — | Fecha, texto, etc.: la fila queda excluida. |

El script no reintenta solo las filas `ENVIANDO` ni `REVISAR`: un reintento automático podría duplicar un correo que sí salió.

### Conciliación manual de `ENVIANDO` y `REVISAR`

Para cada fila con `ENVIANDO` o `REVISAR`:

1. Leé `Detalle` de la fila. `Envío iniciado; si Resultado sigue en ENVIANDO, revisá la carpeta Enviados` indica que la ejecución se cortó después del claim (el correo puede o no haber salido). `Gmail lanzó una excepción (…)` indica un error ambiguo de Gmail. Si tenías el panel abierto, la tabla de resultados agrega el motivo (por ejemplo, `Gmail aceptó el correo, pero no se pudo escribir Email Sent`, o que la fila cambió de posición).
2. En Gmail, abrí la carpeta **Enviados** de la cuenta (o del alias) que envió y buscá un correo a la dirección de la fila con ese asunto, cerca de la hora de `Fecha` (la campaña está en `Campaña`).
3. Si el correo **está** en Enviados: escribí `Email Sent` en `Resultado`.
4. Si el correo **no está**: vaciá `Resultado`. La fila vuelve a ser pendiente; como ya tiene `Fecha`, `Campaña` y `Detalle`, la próxima confirmación pedirá el consentimiento para reemplazarlos.
5. Si no podés determinarlo con certeza, escribí `SKIP` y resolvelo fuera de la herramienta.

Atención: si se insertaron o borraron filas durante un envío, el estado `ENVIANDO` puede haber quedado en otra posición (el script se detiene para no escribir en la fila equivocada). Verificá la dirección de la fila antes de corregirla. Para envíos hechos con la V1, el historial sigue en la pestaña `Registro Mail Merge`.

## Filas que nunca se envían

- **Filas ocultas**, ya sea a mano o por un filtro (aunque tengan `Resultado` vacío), tanto en el envío como en la prueba.
- **Filas con `Resultado` con cualquier valor** (`SKIP`, `Email Sent`, `ENVIANDO`, `REVISAR`, una fecha, cualquier texto).
- **Filas con fórmulas volátiles** (`=NOW()`, `=RAND()`, `=RANDBETWEEN()`, o fórmulas que dependan de ellas). El script compara la fila confirmada con la fila al momento de enviar; como esas fórmulas cambian en cada lectura, la fila se omite **siempre** como `Cambió después de la confirmación`. Reemplazá la fórmula por su valor (Copiar → Pegar solo valores) antes de enviar.
- **Filas inválidas**: dirección inválida o con varias direcciones, `Email Address` vacío, marcador sin valor, enlace no aceptado, archivo inexistente o sin acceso, tipo de archivo no soportado, adjuntos o cuerpo demasiado grandes. Aparecen en `Validar` con su motivo y no cambian de estado (D-19).
- **Filas totalmente vacías**: no se cuentan.

`Scheduled Date` ya no existe como criterio: después de "Preparar columnas" esa columna se llama `Fecha` y no decide la elegibilidad (ver el bloqueo (c)).

## Tope de 500 filas y envío por tandas

Una confirmación admite como mucho **500 filas** (`MAX_CONFIRM_ROWS`, D-41). Si hay más filas válidas, `Revisar envío` responde `Hay N filas para enviar y el máximo por confirmación es 500. Usá un filtro para enviar por tandas` y no prepara nada. Lo mismo, con otro mensaje, si la confirmación supera el tamaño máximo que se puede guardar.

Para enviar por tandas:

1. Activá un filtro en la pestaña (por ejemplo, por una columna propia de grupo o por un rango de filas) que deje visibles como mucho 500 filas pendientes. Las filas ocultas por el filtro no se envían.
2. `Validar`, `Revisar envío` y confirmá esa tanda.
3. Cambiá el filtro para la tanda siguiente y repetí. Las filas ya enviadas quedan `Email Sent` y no se vuelven a enviar.

Además, cada ejecución tiene un presupuesto de tiempo de 4,5 minutos y depende de la cuota diaria de Gmail, así que una tanda puede terminar antes de procesar todas sus filas: las restantes quedan **pendientes** (con `Resultado` vacío) y se envían en otra ejecución.

## Qué se guarda en la caché (D-27, D-46)

La confirmación y el progreso viven en `CacheService.getUserCache()`: una caché aislada por usuario y por script, que vence sola y que Google puede vaciar antes de tiempo.

- **Confirmación** (`MM_CONF_<token>`, 10 minutos, un solo uso): huellas SHA-256 de la plantilla y de cada fila confirmada (y de sus `Fecha`, `Campaña` y `Detalle`), los números de fila, la dirección de la cuenta que ejecuta (y, en la prueba, la casilla de destino, que es la misma cuenta), el remitente y el Reply-To, los identificadores de la pestaña y del borrador, el nombre o ID de campaña, y los números de fila y nombres de columna que se reemplazarían. **Nunca** guarda valores de las filas (destinatarios, variables, enlaces de Drive), los valores de `Fecha` / `Campaña` / `Detalle` ni el contenido de la plantilla.
- **Progreso** (`MM_PROG_<token>`, 30 minutos): números de fila, resultados, detalles (con toda dirección de correo reemplazada por `[dirección]`), contadores y motivo de corte. **No guarda destinatarios.**

El panel solo recibe el token y la vista ya armada; nunca envía filas ni huellas al servidor. Si la caché pierde la confirmación antes de tiempo, el envío responde `La confirmación venció o no es válida; volvé a revisar` y no envía nada.

## Límites configurables (`src/Config.js`)

Los límites están en la constante `LIMITS` de `src/Config.js` (D-11); no se repiten en la lógica. Cambiarlos requiere publicar de nuevo el código (ver "Activación futura").

| Límite | Valor | Para qué |
|---|---|---|
| `MAX_TOTAL_ATTACHMENT_BYTES` | 20 MB | Tamaño total de adjuntos por correo (comunes + de la fila). Por debajo de los 25 MB de Gmail, con margen para la codificación. Los documentos de Google se miden recién al exportarlos a PDF. |
| `MAX_BODY_BYTES` | 200 KB | Tamaño del HTML más el texto plano renderizados (D-21). Es el menor límite de cuerpo de la página de cuotas (cuentas de consumo; Workspace admite 400 KB). |
| `MAX_RUNTIME_MS` | 270 000 ms (4,5 min) | Presupuesto de tiempo por ejecución, por debajo de los 6 min de Apps Script. Se cuenta desde que empieza la ejecución que envía (el clic en `Enviar N correos` o `Enviar prueba`), no desde la preparación (D-30). Al alcanzarlo, el envío se detiene y las filas restantes siguen pendientes. |
| `LOCK_WAIT_MS` | 10 000 ms | Espera máxima por otra ejecución en curso sobre la misma hoja (envío, prueba o "Preparar columnas"). |
| `CONFIRM_TTL_MS` | 600 000 ms (10 min) | Vigencia de una confirmación (D-26). |
| `PROGRESS_TTL_MS` | 1 800 000 ms (30 min) | Vida del registro de progreso en la caché (D-29). |
| `MAX_CONFIRM_ROWS` | 500 | Filas por confirmación (D-41). También es el máximo de filas que lista la validación. |
| `MAX_CACHE_VALUE_BYTES` | 90 KB | Tamaño máximo de lo que se guarda en la caché, por debajo de los 100 KB por valor de `CacheService` (D-41). |
| `MAX_DETAIL_CHARS` | 300 | Largo máximo de `Detalle` (D-38). |
| `MAX_CAMPAIGN_NAME_CHARS` | 80 | Largo máximo del nombre de campaña (D-39). |

La cuota diaria de envíos de Gmail se consulta en cada validación. Si se agota durante el envío, el script se detiene y las filas restantes siguen pendientes para otro día. Si la cuota no se puede leer al momento de enviar, no se envía nada.

## Checklist `PENDING LIVE VALIDATION`

Nada de esto se puede comprobar localmente. Antes de cualquier uso real, cada ítem requiere una verificación en vivo, autorizada y en un entorno de prueba (hoja de prueba, cuenta de prueba, destinatarios de prueba):

1. **Autorización explícita de los scopes amplios (D-24).** `https://mail.google.com/` (acceso completo al buzón) y `https://www.googleapis.com/auth/drive.readonly` (lectura de todo el Drive) son scopes amplios y restringidos por Google. Se aceptaron como riesgo **solo para el desarrollo local**, donde no se otorgan ni se ejercen. Antes de cualquier uso real: revisar la pantalla de consentimiento, la política de Workspace de la organización y obtener la autorización explícita del responsable.
2. Comportamiento real de `LockService.getDocumentLock()` con dos ejecuciones simultáneas (dos envíos, o un envío y "Preparar columnas"), incluida la espera de `LOCK_WAIT_MS` y la liberación.
3. Scopes efectivos que pide el proyecto y pantalla de consentimiento real, contra la lista de `src/appsscript.json`.
4. Alias reales de Gmail como remitente (`from`) y Reply-To real.
5. Cuota diaria real de la cuenta (`MailApp.getRemainingDailyQuota()`).
6. Aspecto del HTML, imágenes inline (emparejadas por el `alt` de la imagen contra su nombre) y firma, en una casilla de prueba.
7. Exportación a PDF de documentos, hojas y presentaciones nativas, y tamaños reales frente a `MAX_TOTAL_ATTACHMENT_BYTES`.
8. Detección de filas ocultas por filtro y ocultas a mano en una hoja real.
9. Tiempos reales por fila frente a `MAX_RUNTIME_MS`, incluido el costo de leer las filas ocultas (dos llamadas al servicio por fila) en hojas grandes.
10. Formatos reales de los enlaces de Drive que usan los operadores frente a los formatos aceptados (D-09).
11. **OPEN (due diligence):** que Apps Script acepte `"timeZone": "Etc/UTC"` en el manifest (la documentación pide un ZoneId sin enumerar los valores aceptados).
12. **OPEN (due diligence):** si existe una combinación de scopes más acotados que `https://mail.google.com/` que alcance para leer borradores y alias y enviar con `GmailApp`. No se exploró (D-24).
13. Que `google.script.run` ejecute `getSendProgress` en paralelo con `executeSendPending` y que el progreso se vea en tiempo real. Si no corre en paralelo, el panel muestra solo el resultado final (degradación aceptada).
14. Comportamiento real de `CacheService.getUserCache()` (aislamiento por usuario, vencimiento, desalojo) y que no pida scopes adicionales.
15. `Utilities.computeDigest` con `Charset.UTF_8` y la conversión a hexadecimal frente al valor esperado. **OPEN (due diligence):** si los bytes vienen con signo; la conversión da el mismo resultado en los dos casos.
16. Renombre de encabezados e inserción de columnas de "Preparar columnas" con filtros, rangos protegidos y formato condicional reales (en particular, que las columnas agregadas queden fuera del rango de un filtro activo sin mostrar filas ocultas).
17. Aspecto y usabilidad del panel (300 px de ancho) con 500 filas en la confirmación. **OPEN (due diligence):** tamaño máximo de las vistas que devuelve `google.script.run` (no documentado).
18. Texto mostrado de `Fecha` según el formato y la zona horaria de la hoja.
19. Tiempo real de cada `getSendProgress` y su efecto sobre la cuota de ejecuciones simultáneas por usuario.
20. **OPEN (due diligence):** `setTimeout` dentro del iframe de `HtmlService` (no documentado para el sandbox) y el cierre del panel con `google.script.host.close()`.
21. Que cerrar el panel durante un envío no corte la ejecución del servidor y que el resultado quede completo en `Resultado` y `Detalle`.

## Activación futura con `clasp` (descripta, no ejecutada)

Estos pasos **no se ejecutaron** y no forman parte del desarrollo local. Requieren la autorización del punto 1 de la checklist, una hoja de prueba y una cuenta de prueba. Confirmá la sintaxis de cada comando contra la documentación vigente de `clasp` en el momento de usarlo.

1. Obtener la autorización explícita de los scopes (D-24) y definir la hoja y la cuenta de prueba.
2. Instalar `clasp` en la máquina del operador autorizado (`npm install -g @google/clasp`) y habilitar la Apps Script API en la configuración de usuario de Apps Script de esa cuenta.
3. `clasp login` con la cuenta de prueba.
4. Crear el proyecto vinculado a la hoja de prueba con `rootDir` en `src/` (por ejemplo `clasp create --type sheets --title "Mail Merge" --rootDir src`), o vincular uno existente con `clasp clone <scriptId> --rootDir src`.
5. Verificar que `.clasp.json` y `.clasprc.json` **no** queden en Git (ya están en `.gitignore`): contienen el ID del script y credenciales locales.
6. `clasp push` para subir `src/` (incluido `appsscript.json`).
7. Abrir la hoja de prueba, recargarla, elegir `Mail Merge → Abrir Mail Merge` y revisar la pantalla de consentimiento contra la lista de scopes.
8. Recorrer la checklist `PENDING LIVE VALIDATION` con destinatarios de prueba, empezando por `Validar`, `Preparar columnas` sobre una copia de una hoja V1 y una prueba.
9. Registrar los resultados y recién entonces decidir, con aprobación escrita, un primer uso real.

Alternativa sin `clasp`: en la hoja de prueba, `Extensiones → Apps Script`, crear un archivo por cada `src/*.js` (incluidos `Setup.js` y `Confirmation.js`) y `src/Sidebar.html` con el mismo nombre, y reemplazar el manifest `appsscript.json` (visible activando la casilla `Show "appsscript.json" manifest file in editor` en la configuración del proyecto).
