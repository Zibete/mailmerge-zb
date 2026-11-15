# Guía de operación — Mail Merge V2 (Eclipse Console)

**Estado:** implementado y verificado **solo en forma local** (`LOCAL_VERIFIED`) con servicios de Google simulados. Nada de esta guía se probó todavía en una cuenta real de Google: todo lo que depende del runtime de Apps Script, de Gmail o de Drive figura como `PENDING LIVE VALIDATION` en la checklist del final. El estado de cada criterio de aceptación está en [`ACCEPTANCE_STATUS.md`](ACCEPTANCE_STATUS.md); el diseño, en `plans/2026-11-09_mail-merge-v2.md` y, para la interfaz del panel (Eclipse Console), en `plans/2026-11-14_eclipse-console-ui.md`.

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

El menú `Mail Merge` tiene un solo ítem, **`Abrir Mail Merge`** (D-25), que abre el panel lateral (300 px de ancho, título `Mail Merge`). Ya no hay diálogos emergentes: todo se ve y se confirma en el panel. Dentro del panel, el producto se presenta como **Mail Merge ZB — Eclipse Console** (D-49, D-52): el menú, el título del panel y el nombre del archivo `Sidebar` no cambian. El diseño es un tema oscuro fijo (D-51), pensado para 300 px; su diseño y sus decisiones están en `plans/2026-11-14_eclipse-console-ui.md`. Nada de esto se vio todavía dentro de Sheets (ítems 22 a 26 de la checklist).

**Cabecera y riel.** Arriba están el nombre `Mail Merge ZB`, el subtítulo `Eclipse Console` y el botón `Cerrar`, que cierra el panel. Debajo, un riel de cuatro puntos numerados (`Etapas de la campaña`: Campaña, Validación, Prueba, Envío) marca la etapa en la que estás: los puntos anteriores figuran como hechos, el actual resaltado y los siguientes como pendientes. El riel solo informa; no bloquea nada.

**Cuatro pasos en acordeón.** `Campaña`, `Validación`, `Prueba` y `Envío` son secciones plegables numeradas. Cada cabecera muestra el número, el título, un resumen corto (por ejemplo el nombre de la campaña, `N elegibles · M errores` o `N correos`) y un chip de estado: `Sin guardar` / `Lista` en el paso 1; `Pendiente`, `Preparar`, `Bloqueada` o `Lista` en el paso 2; `Pendiente`, `Revisión`, `Vencida`, `Enviando` o `Hecha` en los pasos 3 y 4. Por defecto hay un solo paso abierto: el panel abre solo el que corresponde a la fase (primera apertura, campaña guardada, validación correcta, confirmación, resultado) y mueve el foco a su cabecera. Podés abrir cualquier paso a mano en cualquier momento; el acordeón nunca habilita ni deshabilita un botón. El único límite es de seguridad: un paso con una confirmación viva (3 o 4) y la consola mientras se envía **no se pueden plegar**, para que la lista de destinatarios y el progreso no queden ocultos. El botón principal de cada fase se resalta, pero todos los botones existen siempre y el servidor valida todo de nuevo.

**Primera apertura.** Sin configuración guardada, el paso 1 queda abierto con una ayuda de bienvenida (cuatro pasos y que nada se envía sin tu confirmación explícita). Si tu cuenta no tiene borradores de Gmail, el panel te pide crear uno con los marcadores `{{Encabezado}}` y volver a abrirlo.

### 1. Campaña

- **Pestaña de la campaña** (la pestaña `Registro Mail Merge` no se ofrece).
- **Borrador de Gmail (plantilla)** (se muestra como `asunto — fecha`).
- **Remitente**: tu cuenta o uno de sus alias de Gmail.
- **Reply-To (opcional)**: una sola dirección válida.
- **Nombre de campaña (opcional)**: hasta 80 caracteres; se guarda sin saltos de línea ni tabulaciones y recortado. Si lo dejás vacío, cada confirmación (cada envío y cada prueba) genera un ID de 8 caracteres, distinto en cada una, que se muestra en la confirmación y se escribe en `Campaña` de todas las filas de esa ejecución (D-39). Si querés agrupar varias tandas bajo un mismo nombre, escribilo.

El botón `Guardar` vuelve a validar todo en el servidor. La configuración se guarda **por usuario** (D-08): cada operador configura su propia campaña, con su propio borrador. Una configuración guardada con la V1 sigue funcionando (sin nombre de campaña). Guardar de nuevo la configuración borra el resultado de la validación mostrado: hay que volver a validar.

### 2. Validación (el radar)

El botón `Validar` revisa la campaña **sin enviar ni escribir nada**: ni en la hoja ni en la caché (AC-33). El resultado se muestra como un radar:

- cuatro indicadores: `Elegibles`, `Con errores`, `Excluidas` y `Cuota` (la cuota diaria de Gmail, o `no disponible` si no se pudo leer), y una barra segmentada que reparte las filas entre elegibles, con errores y excluidas (solo informativa, no reemplaza a los números);
- pestaña, asunto del borrador, remitente, Reply-To, los conteos y los adjuntos comunes del borrador;
- grupos plegables: `Excluidas por motivo` (plegado por defecto), `Filas con errores` (con sus motivos) y `Filas a enviar`, con todas las filas que se enviarían, `Fila N → destinatario: archivo1, archivo2` (nombres de Drive, nunca URLs), hasta 500 filas y luego `y N filas más` (D-42);
- avisos con ayuda cuando corresponde: cuota desconocida (el envío puede cortarse si se agota), cuota menor que las filas elegibles (queda pendiente el resto), todas las filas excluidas (revisá `Resultado`, filas ocultas y filtros) y, si alguna fila a enviar ya tiene valores en `Fecha`, `Campaña` o `Detalle` que se reemplazarían, un aviso sin casilla (D-47; la confirmación pedirá tu consentimiento);
- si la pestaña necesita preparar sus columnas, qué se renombra, qué se agrega, los bloqueos (con una ayuda para resolverlos a mano) y el botón `Preparar columnas`.

Si la validación encuentra problemas, el mensaje lo dice con conteos (`La validación encontró problemas: N globales · M filas con errores`). Usala antes de cada envío y cada vez que cambies la hoja o el borrador.

### 3. Prueba

Indicás la `Fila a probar` (entero, 2 o mayor); después de una validación correcta, una ayuda lista hasta cinco filas candidatas (`fila (dirección)`) y cuántas más hay. `Revisar prueba` prepara una confirmación para esa sola fila; `Enviar prueba` la envía y `Cancelar` la descarta. La prueba es opcional: `Ir a Envío` abre el paso 4 sin llamar al servidor. Ver "Envío de prueba".

### 4. Envío

`Revisar envío` prepara la confirmación de todas las filas pendientes; `Enviar N correos` envía y `Cancelar` la descarta. Ver "Envío real". Mientras revisás, el paso recuerda que **las vistas de filtro de Sheets no excluyen filas** (solo los filtros normales y las filas ocultas a mano).

### Revisión segura: compuertas y `Falta: …`

Las confirmaciones (prueba y envío) tienen la misma forma: una tarjeta con el aviso del servidor, tal cual, y el resumen (campaña, pestaña, asunto, remitente, Reply-To, filas a enviar, filas con errores y excluidas), los adjuntos comunes como chips, la lista **completa** de destinatarios (una línea por fila, hasta 500, sin desplazamiento interno) cerrada con `── fin de la lista (N) ──`, y un bloque `Verificación` con las compuertas:

- **Revisé todos los destinatarios listados…** (solo en el envío real): obligatoria, también en el servidor (S-02).
- **Consentimiento para reemplazar `Fecha`, `Campaña` o `Detalle`**: solo si hay filas que reemplazar (D-47), con la lista de filas y columnas. En el envío, una ayuda recuerda que esos valores no se pueden recuperar desde esta herramienta.
- Las casillas nacen **sin marcar** en cada confirmación nueva y vuelven a estarlo al cancelar, vencer, terminar o fallar; no hay una opción "marcar todo".
- Mientras falte alguna, una línea de texto lo dice (`Falta: marcar la casilla de filtros`, `Falta: marcar el consentimiento` o `Falta: marcar las 2 casillas`) y el botón de envío sigue deshabilitado. El estado no depende solo del color. La confirmación de la prueba solo pide consentimiento si hay filas que reemplazar y trae una línea fija en la verificación (`Revisá la fila y el destinatario antes de enviar la prueba.`).
- El botón `Enviar prueba` / `Enviar N correos` es único, vive dentro del paso y es el principal de la fase; `Cancelar` es secundario.
- El **vencimiento** se muestra como hora fija, `Vence a las HH:MM (10 min)` (en `test-expiry` y `send-expiry`); no hay cuenta regresiva. Al vencer, el chip del paso pasa a `Vencida`, el botón se deshabilita, aparece `La confirmación venció; volvé a revisar.` y el paso se puede plegar de nuevo.

### 5. Progreso y resultados (la consola)

Aparece al empezar un envío o una prueba y no se puede plegar mientras se envía. Muestra seis contadores (`Total`, `Procesadas`, `Aceptadas por Gmail`, `Omitidas`, `Para revisar` —destacado cuando es mayor que cero— y `Pendientes`), la barra de progreso con la fracción `procesadas/total`, el motivo de corte, el resumen final y el registro por fila (`Fila`, `Destinatario`, `Resultado`, `Detalle`; en 300 px cada fila se apila y trae un chip de estado). El panel no calcula tiempos, tasas ni porcentajes. Al terminar, la consola recibe el foco. Si hay filas para revisar aparece una tarjeta con la conciliación en cinco pasos y, si quedan filas pendientes, una ayuda para volver a `Revisar envío`; si el panel no recibe respuesta del servidor, queda visible el último progreso y la guía de abajo. Ver "Progreso y resultados" y "Conciliación manual".

### Ayudas contextuales

Las ayudas son textos fijos que el panel muestra u oculta según datos reales de la validación, la confirmación y el resultado (nunca por comparar textos del servidor, que se muestran tal cual): bienvenida y falta de borradores (paso 1); validar antes de enviar; preparar columnas y bloqueos; cuota desconocida o insuficiente; todo excluido; filas a reemplazar; opcionalidad de la prueba y filas candidatas; vistas de filtro y consentimiento (al revisar el envío); conciliación, pendientes, resultado incierto y qué hacer después de una prueba (en la consola). No hay IA ni llamadas adicionales.

### Accesibilidad

Todos los controles tienen etiqueta; los pasos son botones con `aria-expanded`; el punto actual del riel se marca con `aria-current`; los mensajes de cada paso y el estado del progreso se anuncian como `status`, una región `status` global anuncia los cambios de fase y `Enviando: N de M` solo cuando cambia `processed`, y la guía de resultado incierto y el motivo de corte se anuncian como `alert`. El foco visible está definido y las animaciones se desactivan con `prefers-reduced-motion`. Los pares de colores de texto se verifican por test contra el contraste AA; con lectores de pantalla dentro de Sheets queda `PENDING LIVE VALIDATION` (ítem 24).

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
| **(e)** La pestaña no tiene `Mail Merge Status`, le falta alguna columna gestionada y, o bien no tiene encabezados heredados y ya tiene `Resultado`, o bien todavía tiene `Scheduled Date` (con o sin `Resultado`, por ejemplo después de una preparación interrumpida); y alguna de `Fecha`, `Campaña` o `Detalle` tiene valor en una fila sin estado (`Resultado` vacío, o cualquier fila si todavía no hay `Resultado`), aunque esté oculta | Mail Merge reemplazaría esos valores al enviar esas filas | El error nombra la columna y las filas. Renombrá la columna como en (b) o, si esas celdas no tienen datos que conservar, vacialas. Volvé a validar. |

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
3. Es obligatorio marcar **«Revisé todos los destinatarios listados»**. Las vistas de filtro de Sheets **no excluyen filas**: el programa solo detecta las ocultas manualmente y las ocultas por filtros normales. Para seleccionar un subconjunto, usá **Datos → Crear un filtro** o `Resultado = SKIP`; verificá la lista completa antes de marcar la casilla. También se exige este reconocimiento en el servidor, no solo en el panel.
4. Si alguna fila a enviar ya tiene valores en `Fecha`, `Campaña` o `Detalle`, aparece otra casilla de consentimiento y `Enviar N correos` queda deshabilitado hasta marcarla.
5. Un solo clic en `Enviar N correos` envía; el botón se deshabilita desde el primer clic y el panel no vuelve a llamar al servidor por su cuenta (D-45). `Cancelar` descarta la confirmación sin enviar nada. Pasados los 10 minutos el botón se deshabilita y hay que volver a `Revisar envío`.

**Revisión antes de confirmar (D-42).** Cualquier persona con permiso de edición sobre la hoja puede cambiar destinatarios y enlaces. Antes de confirmar, verificá en el panel que cada dirección sea la correcta y que los archivos listados sean los que corresponden a esa persona. El panel lista todas las filas (hasta 500); desplazate hasta el final antes de confirmar.

Al enviar, el servidor vuelve a leer todo desde cero:

- si cambió el contenido de un adjunto o una imagen inline del borrador, aun conservando nombre y tamaño, **cancela todo** sin enviar nada;
- si se modificó algún archivo de Drive vinculado a una fila desde la confirmación, **omite esa fila** y sigue con las demás; se compara la fecha de última modificación además de ID, nombre, tipo y tamaño (no se calcula una huella del contenido de Drive);
- si cambiaron la plantilla, los encabezados, el remitente o el Reply-To, **cancela todo** sin enviar nada (D-15);
- si cambió la configuración guardada (pestaña, borrador, remitente, Reply-To o nombre de campaña, por ejemplo desde otra pestaña del navegador), **cancela todo** sin enviar nada (D-43);
- si cambió una fila (destinatario, enlaces, `Resultado` o cualquier otro valor), **omite esa fila** como `Cambió después de la confirmación` y sigue con las demás;
- si cambiaron `Fecha`, `Campaña` o `Detalle` de una fila después de confirmar, **omite esa fila** sin escribir nada en ella (ver D-48 abajo) y sigue con las demás;
- si otra persona está enviando o preparando columnas en la misma hoja, espera hasta 10 segundos; si no puede tomar el turno, termina con `Hay otra ejecución en curso; reintentá en unos minutos`.

**Cambios durante el envío:** después de descargar los adjuntos, el motor relee la fila y vuelve a comprobar su identidad y visibilidad antes de marcar `ENVIANDO`. Una segunda comprobación posterior al marcado y anterior a Gmail impide enviar si detecta que se movió u ocultó. **No es una transacción atómica:** si se reordena la hoja durante el marcado, `ENVIANDO` puede quedar en otra fila. En ese caso la ejecución se detiene **sin llamar a Gmail para esa fila** y exige conciliación manual de la hoja; no borres el estado a ciegas. Evitá ordenar, insertar o mover filas durante una campaña.

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

- **Filas ocultas manualmente o por un filtro normal** (aunque tengan `Resultado` vacío), tanto en el envío como en la prueba. **No incluye vistas de filtro** (`Datos → Vistas de filtro`): Sheets no informa esa selección a `isRowHiddenByFilter()`. Si usás una vista de filtro, sus filas no visibles también pueden enviarse; para excluirlas, usá un filtro normal o `Resultado = SKIP`. El envío real exige reconocer explícitamente esta limitación.
- **Filas con `Resultado` con cualquier valor** (`SKIP`, `Email Sent`, `ENVIANDO`, `REVISAR`, una fecha, cualquier texto).
- **Filas con fórmulas volátiles** (`=NOW()`, `=RAND()`, `=RANDBETWEEN()`, o fórmulas que dependan de ellas). El script compara la fila confirmada con la fila al momento de enviar; como esas fórmulas cambian en cada lectura, la fila se omite **siempre** como `Cambió después de la confirmación`. Reemplazá la fórmula por su valor (Copiar → Pegar solo valores) antes de enviar.
- **Filas inválidas**: dirección inválida o con varias direcciones, `Email Address` vacío, marcador sin valor, enlace no aceptado, archivo inexistente o sin acceso, tipo de archivo no soportado, adjuntos o cuerpo demasiado grandes. Aparecen en `Validar` con su motivo y no cambian de estado (D-19).
- **Filas totalmente vacías**: no se cuentan.

`Scheduled Date` ya no existe como criterio: después de "Preparar columnas" esa columna se llama `Fecha` y no decide la elegibilidad (ver el bloqueo (c)).

## Tope de 500 filas y envío por tandas

Una confirmación admite como mucho **500 filas** (`MAX_CONFIRM_ROWS`, D-41). Si hay más filas válidas, `Revisar envío` responde `Hay N filas para enviar y el máximo por confirmación es 500. Usá un filtro para enviar por tandas` y no prepara nada. Lo mismo, con otro mensaje, si la confirmación supera el tamaño máximo que se puede guardar.

Para enviar por tandas:

1. Activá un **filtro normal** (`Datos → Crear un filtro`, no una vista de filtro) en la pestaña, por ejemplo por una columna propia de grupo, que deje visibles como mucho 500 filas pendientes. Las filas ocultas por ese filtro no se envían.
2. `Validar`, `Revisar envío` y confirmá esa tanda.
3. Cambiá el filtro para la tanda siguiente y repetí. Las filas ya enviadas quedan `Email Sent` y no se vuelven a enviar.

Además, cada ejecución tiene un presupuesto de tiempo de 4,5 minutos y depende de la cuota diaria de Gmail, así que una tanda puede terminar antes de procesar todas sus filas: las restantes quedan **pendientes** (con `Resultado` vacío) y se envían en otra ejecución.

## Qué se guarda en la caché (D-27, D-46)

La confirmación y el progreso viven en `CacheService.getUserCache()`: una caché aislada por usuario y por script, que vence sola y que Google puede vaciar antes de tiempo.

- **Confirmación** (`MM_CONF_<token>`, 10 minutos, un solo uso): huellas SHA-256 de la plantilla (incluido el contenido binario de adjuntos e imágenes inline del borrador) y de cada fila confirmada (incluidas versiones de adjuntos de Drive) (y de sus `Fecha`, `Campaña` y `Detalle`), los números de fila, la dirección de la cuenta que ejecuta (y, en la prueba, la casilla de destino, que es la misma cuenta), el remitente y el Reply-To, los identificadores de la pestaña y del borrador, el nombre o ID de campaña, y los números de fila y nombres de columna que se reemplazarían. **Nunca** guarda valores de las filas (destinatarios, variables, enlaces de Drive), los valores de `Fecha` / `Campaña` / `Detalle` ni el contenido de la plantilla.
- **Progreso** (`MM_PROG_<token>`, 30 minutos): números de fila, resultados, detalles (con toda palabra que contenga `@` reemplazada por `[dirección]` antes de recortar, así que tampoco quedan fragmentos de direcciones), contadores y motivo de corte. **No guarda destinatarios.**

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
22. Render real en el iframe de `HtmlService` de `<style>` con custom properties, SVG inline, `mask-image` con `data:` URI, `color-scheme`, `:focus-visible` y `prefers-reduced-motion` (Eclipse Console). **OPEN (due diligence):** que el iframe no los reescriba ni los bloquee, y que `prefers-reduced-motion` se evalúe igual dentro del iframe anidado de Sheets.
23. Aspecto del panel oscuro junto a una hoja clara de Sheets y legibilidad de los controles nativos (`select`, `input`, `progress`, casillas) con `color-scheme: dark`.
24. Comportamiento del acordeón, del foco y de los anuncios `role="status"` / `role="alert"` con lectores de pantalla dentro de Sheets.
25. Rendimiento y desplazamiento con 500 filas en la confirmación con el nuevo marcado (amplía el ítem 17).
26. Tamaño del HTML servido por `createHtmlOutputFromFile` con el CSS e iconos nuevos (no hay límite publicado).

Los ítems 13 (`getSendProgress` en paralelo), 17 (500 filas) y 20 (`setTimeout` en el iframe) siguen vigentes.

### Checklist visual de la vista previa local (AC-64, manual)

`tools/preview-sidebar.js` genera una página que muestra `src/Sidebar.html` con un `google.script.run` falso y datos ficticios (`example.test`), para ver el aspecto del panel en un navegador sin Google. Es una herramienta manual: **esta checklist todavía no se ejecutó** y AC-64 sigue `PENDING (manual)`; quien la recorra tiene que registrar el resultado en `ACCEPTANCE_STATUS.md`.

1. `node --check tools/preview-sidebar.js` y `node tools/preview-sidebar.js [estado]` (con Node portable, ver `README.md`). Escribe `tmp/sidebar-preview.html` (carpeta ignorada por Git). No toca `src/` ni se sube a Apps Script.
2. Abrí `tmp/sidebar-preview.html` en Chrome o Edge. El panel mide 300 px; cambiá de estado con la barra de la vista previa o con `?state=<estado>`.
3. Recorré los 13 estados a 300 px: `inicial`, `sin-borradores`, `configurada`, `setup`, `bloqueada`, `lista`, `prueba`, `envio`, `consentimiento`, `enviando`, `terminada`, `revisar` e `incierta`. Los que requieren recorrer el flujo (`prueba`, `envio`, `enviando`, `terminada`, `revisar`, `incierta`) se alcanzan con los botones reales del panel; el falso solo decide qué responde cada llamada.
4. En cada estado comprobá: **sin desplazamiento horizontal** del panel; **foco visible** al navegar con el teclado (Tab); **chips y contadores legibles** (texto no cortado, estado también en texto y no solo en color); y los pasos y botones esperados para la fase.
5. Estado `lista-500` (500 filas ficticias en la validación y en las confirmaciones): la lista completa se lee sin scroll interno y con fin de lista.

**Alcance:** la vista previa valida el aspecto en un navegador real, pero **no valida lo que `HtmlService` ignora o reescribe** (por ejemplo, las etiquetas `<meta>` escritas en el archivo, o el sandbox del iframe) **ni reemplaza los ítems 22 a 26** de la checklist en vivo. Las capturas para GitHub, cuando existan, van en `docs/screenshots/`; hoy no hay ninguna.

## Activación futura con `clasp` (descripta, no ejecutada)

Estos pasos **no se ejecutaron** y no forman parte del desarrollo local. Requieren la autorización del punto 1 de la checklist, una hoja de prueba y una cuenta de prueba. Confirmá la sintaxis de cada comando contra la documentación vigente de `clasp` en el momento de usarlo.

1. Obtener la autorización explícita de los scopes (D-24) y definir la hoja y la cuenta de prueba.
2. Instalar `clasp` en la máquina del operador autorizado (`npm install -g @google/clasp`) y habilitar la Apps Script API en la configuración de usuario de Apps Script de esa cuenta.
3. `clasp login` con la cuenta de prueba.
4. Crear el proyecto vinculado a la hoja de prueba, con `src/` como raíz: `clasp create-script --parentId <id de la hoja de prueba> --rootDir src` (`--parentId` vincula el script a la hoja existente; `--type sheets` crearía una hoja nueva), o vincular uno existente con `clasp clone-script <scriptId> --rootDir src`. Los nombres anteriores `create` y `clone` figuran como alias: confirmalo contra la documentación vigente de `clasp` al usarlos.
5. Verificar que `.clasp.json` y `.clasprc.json` **no** queden en Git (ya están en `.gitignore`): contienen el ID del script y credenciales locales.
6. `clasp push` para subir `src/` (incluido `appsscript.json`).
7. Abrir la hoja de prueba, recargarla, elegir `Mail Merge → Abrir Mail Merge` y revisar la pantalla de consentimiento contra la lista de scopes.
8. Recorrer la checklist `PENDING LIVE VALIDATION` con destinatarios de prueba, empezando por `Validar`, `Preparar columnas` sobre una copia de una hoja V1 y una prueba.
9. Registrar los resultados y recién entonces decidir, con aprobación escrita, un primer uso real.

Alternativa sin `clasp`: en la hoja de prueba, `Extensiones → Apps Script`, crear un archivo por cada `src/*.js` (incluidos `Setup.js` y `Confirmation.js`) y `src/Sidebar.html` con el mismo nombre, y reemplazar el manifest `appsscript.json` (visible activando la casilla `Show "appsscript.json" manifest file in editor` en la configuración del proyecto).
