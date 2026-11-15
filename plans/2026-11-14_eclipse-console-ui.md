# Plan — Eclipse Console: release UI/UX de Mail Merge ZB (Apps Script V8)

**Estado:** plan canónico de `spec-driven-dev` para la última gran iteración de interfaz antes de la publicación open source. Evoluciona la sidebar implementada en `plans/2026-11-09_mail-merge-v2.md` (`LOCAL_VERIFIED`) y las correcciones de `plans/2026-11-09_seguridad-envios-v2.md` (S-01 a S-03). Rama `feat/ui-ux-release`, creada desde `main` en `0a0a028`. Baseline confirmada el 2026-11-14: `node --test` = 322 tests, 322 pass, 0 fail. Decisiones nuevas desde `D-49`; criterios nuevos desde `AC-56`. Meta: `LOCAL_VERIFIED` con validación visual en navegador descripta y ejecutable localmente; todo lo que dependa de Google queda `PENDING LIVE VALIDATION`.

Insumos reutilizados (no se repite el discovery): el diagnóstico de usabilidad del UX Researcher (14 hallazgos, dos direcciones, contraste de la paleta) y la auditoría de contratos del Contract Auditor (contrato cliente-servidor, 31 tests de `tests/sidebar.test.js` (hoy son 32: se agregó el de P0-2), restricciones de `tests/helpers/fake-dom.js`, invariantes, literales citados en la documentación, riesgos de HtmlService). Sus conclusiones están incorporadas en este plan; donde este plan y esos informes difieran, prevalece este plan.

> **Actualización 2026-11-15 (D-61 a D-63):** tras probar la sidebar en Google Sheets, el responsable aprobó reemplazar el subtítulo visible `Eclipse Console` por `Envío desde Google Sheets`, usar acordeón que permite cerrar el paso abierto y mostrar un recordatorio persistente al ocultar una confirmación o navegar durante un envío, y compactar los textos de Validación, Prueba, Envío y resultados. Estas decisiones **sustituyen** la parte de D-52/D-57/D-58 que indicaba el subtítulo anterior, los toggles deshabilitados y las ayudas redundantes. El plan original conserva su valor histórico; la implementación y los tests actuales son la fuente operativa. Ver `docs/DECISIONS.md`.

## Contexto

La sidebar V2 (`src/Sidebar.html`, 1028 líneas) concentra configuración, validación, prueba, confirmación y progreso en un solo archivo con un modelo de estado del cliente correcto (`state.busy`, `state.confirmations[kind]`, `state.run`, `refreshControls()`), todo texto del servidor insertado por `textContent` / `new Option`, y 32 tests que ejecutan el script real en un DOM falso. Sus deficiencias son de presentación: cinco secciones iguales siempre expandidas sin indicación del paso siguiente; sin identidad visual; lista de hasta 500 destinatarios y tabla de cuatro columnas ilegibles en 300 px; `Enviar N correos` y `Cancelar` indistinguibles; consentimientos densos; estados solo por color; sin estados vacíos ni ayudas; cinco regiones `aria-live`; foco no gestionado.

Este plan reemplaza la capa de presentación conservando el contrato, la máquina de estados y las garantías de seguridad. La identidad del producto dentro del panel es **Mail Merge ZB — Eclipse Console**; el menú de Sheets, el título de Apps Script y el nombre del archivo `Sidebar` no cambian.

## Invariantes que se preservan (no negociables)

- Las diez funciones públicas de `src/Ui.js` (`getPanelState`, `saveConfig`, `validateCampaign`, `applyColumnSetup`, `prepareTestSend`, `executeTestSend`, `prepareSendPending`, `executeSendPending`, `getSendProgress`, `cancelConfirmation`) con sus argumentos exactos: `saveConfig({ sheetId, draftId, from, replyTo, campaignName })` con textos recortados; `applyColumnSetup(headerKey: string)`; `prepareTestSend(rowNumber: string recortado)`; `executeTestSend(token, overwriteConsent === true)`; `executeSendPending(token, overwriteConsent === true, filterAcknowledged === true)` con booleanos estrictos; `getSendProgress(token)`; `cancelConfirmation(token)`. Sin llamadas nuevas, sin campos nuevos en `ValidationView`, `ConfirmationView`, el progreso en caché ni `SendResultView`. `src/*.js` y `src/appsscript.json` sin cambios.
- Las casillas `send-filter-ack`, `send-consent` y `test-consent` nacen desmarcadas en cada confirmación nueva y al descartar, cancelar, vencer, terminar o fallar; nunca se pre-marcan ni existe "marcar todo"; el servidor sigue exigiendo ambos consentimientos (S-02, D-47).
- Un solo `execute…` por token, con `confirmation.used = true` antes de llamar y un único punto de entrada `execute(kind)` protegido por `canExecute(kind)`; sin reintentos; sin botón "Reintentar"; la guía literal de D-45 queda visible hasta que empieza una ejecución nueva (`startRun()` la oculta, como hoy; un `prepare…` nuevo no la oculta, según el test «AC-52 / D-45: una falla de executeSendPending…») (D-45).
- Sondeo con un único `setTimeout` encadenado de `PROGRESS_POLL_MS = 2000`, una llamada `getSendProgress` por vez, detenido cuando `execute…` responde o falla (D-29). Ningún temporizador nuevo: cero timers al cargar, exactamente uno (vencimiento) tras preparar una confirmación, exactamente uno (sondeo) durante una ejecución. Sin `setInterval`, sin `requestAnimationFrame`, sin cuenta regresiva.
- `textContent`, `new Option` y `document.createElement` como únicas vías de inserción de datos. Sin `innerHTML` (ni como subcadena en todo el archivo), `insertAdjacentHTML`, `DOMParser`, `cloneNode`, `<template>`, `querySelector*`, `alert`, `confirm`, `prompt`, `<script src>`, `<link>`, `@import`, `url(http…)`, fuentes web ni librerías. Un solo `<script>`.
- Ningún `href`, `src`, `title`, `class` ni atributo construido con texto del servidor. El `result` de cada fila se mapea a estilos solo por comparación con la lista cerrada `Email Sent`, `OMITIDA`, `NO ENVIADA`, `ENVIANDO`, `REVISAR`; cualquier otro valor usa el estilo neutro.
- La confirmación muestra todas las filas (hasta 500) con destinatario y nombres de adjuntos, visibles sin interacción adicional, antes de las casillas (D-42). El `warning` de la confirmación se muestra literal. El progreso en caché no trae direcciones: el destinatario se resuelve desde la `ConfirmationView` vigente (D-46). Nada de URLs.
- Nada derivado en el cliente: sin tiempo restante, tasa, porcentaje distinto de `processed / total`, "entregados" (D-13: solo "aceptados por Gmail") ni cancelación de envíos iniciados. `<progress max=total value=processed>`.
- Los 50 ids que usan los tests y el script (más `section-campaign`, `section-validation`, `section-test` y `section-send`, que se conservan aunque nadie los lee) se conservan con el mismo elemento y la misma semántica: `sheet, draft, from, reply-to, campaign-name, save, config-message, validate, validation-message, validation-result, setup-box, setup-list, apply-setup, test-row, review-test, test-message, test-confirmation, test-view, test-consent-box, test-consent, test-consent-text, test-consent-rows, execute-test, cancel-test, review-send, send-message, send-confirmation, send-view, send-filter-ack, send-consent-box, send-consent, send-consent-text, send-consent-rows, execute-send, cancel-send, progress-section, progress-status, count-total, count-processed, count-sent, count-skipped, count-review, count-pending, progress-bar, progress-guidance, stopped-reason, summary, progress-truncated, results-body, close`. `results-body` sigue siendo un `<tbody>` con `<tr>` de exactamente cuatro `<td>`; los selects se llenan solo con `new Option` y una opción vacía inicial `Elegí una opción…`; la carga del panel no crea ningún elemento; la validación no crea ningún `<input>`.
- Literales que los tests o `docs/OPERATIONS.md` citan, sin cambios: `Enviar prueba`, `Enviar 1 correo`, `Enviar N correos` (como `textContent` completo del botón), `Esperando el inicio del envío…`, la guía `No se pudo confirmar el resultado. Revisá la columna Resultado (ENVIANDO / REVISAR) antes de volver a enviar`, `Motivo de corte: `, `Fila N → email: a.pdf, b.pdf`, `fila N (Fecha, Detalle)`, `Elegí una opción…`, los mensajes con «guardada», «Elegí», «venció», «fila», `Configuración guardada. Usá "Validar" antes de enviar.`, `Columnas preparadas.`, `Confirmación cancelada; no se envió nada.`, `Confirmación descartada; no se envió nada y vence sola en 10 minutos.`, `Sin respuesta del servidor.`, `Prueba terminada.` / `Envío terminado.`, `Terminado; revisá el resultado en "Progreso y resultados".`, los nombres de botones `Guardar`, `Validar`, `Preparar columnas`, `Revisar prueba`, `Revisar envío`, `Cancelar`, `Cerrar`, los títulos `Campaña`, `Validación`, `Prueba`, `Envío`, `Progreso y resultados`, las etiquetas del formulario, los contadores `Total`, `Procesadas`, `Aceptadas por Gmail`, `Omitidas`, `Para revisar`, `Pendientes`, las columnas `Fila`, `Destinatario`, `Resultado`, `Detalle`, el texto de la casilla de filtros y el formato `asunto — fecha` del borrador. El mensaje `La validación encontró problemas.` se enriquece con conteos (ver "Detalle del código"); no lo cita ningún test ni documento.
- Menú `Mail Merge → Abrir Mail Merge`, `createHtmlOutputFromFile('Sidebar')` y `setTitle('Mail Merge')` sin cambios (D-25). Los tests de `tests/sidebar.test.js` y `tests/ui.test.js` no se renombran ni se relajan; solo se amplía el test `fake-dom: document y los elementos lanzan fuera del subconjunto permitido` para cubrir la lista nueva de D-50.
- Español rioplatense en la interfaz; literales de compatibilidad sin traducir (`Email Address`, `File Attachments`, `Fecha`, `Campaña`, `Resultado`, `Detalle`, `SKIP`, `Email Sent`, `ENVIANDO`, `REVISAR`, `[PRUEBA]`). Git solo local; sin `clasp`, OAuth, envíos ni acceso a Google.

## Enfoque

Mismo contrato, misma máquina de estados, nueva capa de presentación dentro de `src/Sidebar.html`. Tres piezas nuevas en el cliente, todas funciones puras sobre el estado que ya existe: `derivePhase()` (en qué paso está el operador), `hintsFor()` (qué ayuda mostrar) y `renderers` por experiencia (cómo pintar cada vista). La interfaz se organiza como un **Command Center** de cuatro pasos en acordeón con un riel de etapa en la cabecera, un **Radar** de validación con indicadores, una **Revisión segura** con compuertas de consentimiento, una **Consola de ejecución** con contadores y registro por fila, y ayudas contextuales deterministas. Todo con `hidden`, `className` y `textContent`; iconos SVG estáticos en el marcado o por CSS; animaciones solo en CSS y desactivadas con `prefers-reduced-motion`.

## Alternativas evaluadas

### Dirección visual

- **A "Eclipse Sobrio"** (acordeón numerado, un paso abierto por vez, resúmenes en las cabeceras cerradas, botón primario contextual dentro del paso activo): mapea 1:1 con los ids actuales, deja el ancho completo a la lista de destinatarios y resuelve los hallazgos de flujo y jerarquía solo con `hidden` y `className`.
- **B "Eclipse Consola"** (riel vertical de 24 px con el contexto de todos los pasos siempre visible, contadores en monoespaciada, registro de líneas en lugar de tabla): más fiel al nombre, pero resta ~30 px de ancho útil a la lista que D-42 obliga a revisar entera, exige más marcado nuevo y su registro como `<ul>` rompe el test que exige `<tr>` con cuatro `<td>` en `results-body`.
- **Elegida (aprobada por el usuario): A como base con dos piezas de B**, los resúmenes de estado por paso y la presentación de registro de líneas, obtenida con CSS sobre la `<table>` existente.

### Barra de acción fija al pie

Se evaluó una barra `position: sticky` con el botón del paso activo. Se descarta: un segundo botón de envío (o un botón "movido" por CSS fuera de su sección) duplica el punto de entrada a `execute(kind)` o separa el botón de las casillas que lo habilitan, y `sticky` dentro del iframe de HtmlService es `PENDING LIVE VALIDATION`. El botón primario vive dentro del paso abierto, inmediatamente después de las casillas que lo habilitan.

### Vencimiento de la confirmación

Se evaluó una cuenta regresiva "vence en mm:ss". Se descarta: exige un timer por segundo y rompe la garantía de un solo temporizador (D-29, tests de `pendingTimers()`). Se muestra `Vence a las HH:MM (10 min)` con el `expiryTimer` existente, y al vencer el chip del paso pasa a `Vencida`.

### Iconos

Se evaluó crear iconos por script (`createElementNS`) o con un sprite `<symbol>`/`<use>`. Se elige: SVG inline estático en el marcado para elementos fijos (cabecera, riel, cabeceras de paso, tiles, compuertas) y, para los nodos que el script crea o cuyo `textContent` reescribe (chips de fila, botones de envío), iconos por CSS (`::before` con `mask-image: url("data:image/svg+xml,…")` y `background-color: currentColor`). Sin `createElementNS`, sin `<template>`, sin sprite (los `id` de un sprite se registrarían en el DOM falso sin aportar nada).

## Decisiones de implementación

| ID | Decisión | Motivo |
|---|---|---|
| D-49 | Este plan reemplaza la sección "Detalle del código > Sidebar" del plan V2 en lo visual y estructural (orden y agrupación de secciones, estilos, textos de ayuda, iconografía, acordeón, riel), y conserva de ella las reglas del cliente (una operación de servidor por sección, un `execute…` por token, sondeo encadenado, datos solo por `textContent` / `new Option` / `createElement`, manejadores en el global `MailMergePanel`, solo `getPanelState()` al cargar) y el subconjunto de DOM, ampliado únicamente por D-50. Se registra en `docs/DECISIONS.md` como modificación de D-25 en lo que respecta a la presentación. | `AGENTS.md` excluye rediseños fuera de la especificación: la especificación nueva es este plan, aprobado por el usuario. |
| D-50 | `tests/helpers/fake-dom.js` se amplía con exactamente: `setAttribute(name, value)`, `getAttribute(name)` y `removeAttribute(name)` restringidos a `^(aria-[a-z]+\|role)$` (cualquier otro nombre lanza; el valor se guarda como texto en un mapa por nodo), `focus()` y `blur()` como no-op que registran el `id` enfocado (expuesto a los tests como `dom.focusedId()`), y la lectura de los atributos estáticos `aria-*` y `role` del marcado en los elementos con `id`. No se amplían `classList`, `dataset`, `style`, `querySelector*`, `createElementNS`, `cloneNode`, `innerHTML`, eventos `input`/`keydown`/`submit` ni temporizadores. | Lista blanca mínima para accesibilidad dinámica (`aria-expanded`, `aria-current`, `aria-busy`, `aria-describedby`) y gestión del foco (WCAG 2.4.3), sin tocar las cuatro barreras del helper (texto solo por `textContent`, elementos solo por `createElement`, sin selectores ni HTML crudo, un canal de llamadas registrado). |
| D-51 | Tema oscuro fijo (Dark Minimal) con `color-scheme: dark` en el `:root` del CSS (no con `<meta name="color-scheme">`: HtmlService ignora las etiquetas `<meta>` escritas en el archivo HTML y `addMetaTag` no admite `color-scheme`) para que `select`, `input`, `progress` y casillas nativas acompañen. Sin `prefers-color-scheme`; la variante clara queda diferida a una decisión futura. | Aprobado por el usuario para esta iteración. Contraste WCAG AA verificado por test (AC-62). El contraste del panel oscuro con la hoja clara de Sheets es un riesgo visual aceptado, a revisar en vivo. |
| D-52 | Identidad **Mail Merge ZB — Eclipse Console** solo dentro del panel (cabecera). `MENU_TITLE_`, `MENU_OPEN_PANEL_`, `PANEL_TITLE_` y el nombre del archivo `Sidebar` no cambian. La documentación describe la instalación como **script vinculado** a una hoja (editor de Apps Script o `clasp` descripto y no ejecutado), nunca como complemento de Marketplace. | Minimiza cambios de contrato (tests de `tests/ui.test.js`, `docs/OPERATIONS.md`, `README.md`). |
| D-53 | Ningún temporizador nuevo en el cliente. Microinteracciones solo con `transition`/`animation` de CSS, envueltas en `@media (prefers-reduced-motion: no-preference)`; con `reduce` no hay movimiento. Vencimiento como hora fija más `(10 min)`. | D-29 y los tests de temporizadores; accesibilidad (WCAG 2.3.3). |
| D-54 | Iconografía SVG de 16 px, `stroke="currentColor"`, `stroke-width="1.75"`, `fill="none"`, `aria-hidden="true"`, `focusable="false"`, estática en el marcado para elementos fijos; para nodos creados por el script o cuyo `textContent` se reescribe, icono por CSS `mask-image` con `data:image/svg+xml` y `currentColor`. Ningún `<svg>` dentro de un elemento cuyo `textContent` escriba el script. Ningún `<svg>` con `id`. | Compatibilidad con el DOM falso (sin `createElementNS`), color heredado del estado, sin recursos externos. Hallazgo 15 del diagnóstico. |
| D-55 | La tabla de progreso y resultados conserva `<table>`, `<thead>` con `Fila`, `Destinatario`, `Resultado`, `Detalle`, y `<tbody id="results-body">` con `<tr>` de cuatro `<td>`. En 300 px se apila por CSS (`display: block` en `tr`/`td`, etiqueta por `td:nth-child(n)::before` con `content`), con un chip de estado por `className` de la fila elegido de la lista cerrada de resultados (`row--sent`, `row--skipped`, `row--notsent`, `row--sending`, `row--review`, `row--neutral`). | Conserva el test «D-29: … un solo temporizador…» y la semántica de tabla para lectores de pantalla, con la lectura de registro de líneas de la dirección B. |
| D-56 | `derivePhase()` es una función pura del estado del cliente que devuelve uno de `sin-configurar`, `configurada`, `preparar-columnas`, `bloqueada`, `lista`, `revisando-prueba`, `revisando-envio`, `enviando`, `terminada`, `incierta`. Alimenta el riel, los chips de paso, el acordeón, el énfasis del botón primario y las ayudas. No decide nada de negocio: todos los botones existen siempre, con su `disabled` real calculado por `refreshControls()` como hoy, y el servidor valida todo. Se expone como `MailMergePanel.phase()` para los tests. | Command Center sin llamadas nuevas y sin debilitar el gating actual. |
| D-57 | El acordeón tiene cuatro pasos (`Campaña`, `Validación`, `Prueba`, `Envío`) más la consola `Progreso y resultados`. Cada paso tiene una cabecera `<button type="button" id="step-N-toggle">` con número, título, resumen (`id="step-N-summary"`) y chip (`id="step-N-chip"`), y un cuerpo `id="step-N-body"` alternado con `hidden`. Al completar un paso se abre el siguiente automáticamente y se mueve el foco a su cabecera. Un paso con confirmación viva o en ejecución y la consola mientras `running()` **no pueden colapsarse** (su toggle queda `disabled`). El operador puede abrir cualquier otro paso manualmente; nada se bloquea por el acordeón, solo por `refreshControls()`. | Flujo guiado (hallazgo 1) sin ocultar nunca la lista de destinatarios ni el progreso (D-42, D-45). |
| D-58 | Las ayudas contextuales son párrafos estáticos en español con `id="hint-*"`, alternados con `hidden` por `hintsFor(phase, data)` a partir de campos reales (`panel.drafts.length`, `current`, `setup.needed`, `setup.errors`, `globalErrors`, `counts`, `quotaRemaining`, `overwriteRows`, `consentRequired`, `excludedByReason`, `rowsTruncated`, `stoppedReason`, `counts.review`, `counts.pending`, falla de transporte). Los textos del servidor (`reason`, `detail`, errores) se muestran verbatim y nunca se comparan con literales en el cliente, salvo `row.result` contra la lista cerrada de D-55. Sin IA, sin heurísticas sobre texto, sin llamadas nuevas. | Contextual Intelligence basada en estados reales (pedido 5). |
| D-59 | Validación visual local con `tools/preview-sidebar.js`: un script de Node (sin dependencias) que lee `src/Sidebar.html`, inserta antes del `<script>` real un `<script>` con un `google.script.run` falso que responde con las vistas ficticias de `tests/fixtures/sidebar-views.js` según `?state=…`, y escribe `tmp/sidebar-preview.html` (carpeta ignorada por Git). Se abre en un navegador con el panel a 300 px de ancho. Nunca se sube a Apps Script; `src/` no cambia. Las capturas para GitHub se toman de esa vista previa y se guardan en `docs/screenshots/` solo cuando existan; el plan no las declara tomadas. | Pedido de validación visual real en navegador sin credenciales; evidencia para `docs/ACCEPTANCE_STATUS.md`. |
| D-60 | Regiones vivas: los cuatro `<p id="…-message">` y `progress-status` conservan `role="status" aria-live="polite"` (sin cambios de marcado ni de textos; el aviso de vencimiento `La confirmación venció; volvé a revisar.` sigue anunciándose como `status` dentro de su `…-message`); se agrega una región `status` global `id="status-live"` (visualmente oculta) para los anuncios de fase y de progreso; `progress-guidance` y `stopped-reason` pasan a `role="alert"`. Los contadores se anuncian solo con el cambio de `processed` (texto `Enviando: N de M`), no cada 2 s. Se acepta tener varias regiones `status`: cada una vive en un paso distinto y solo una recibe texto por vez. Duda menor resuelta con la alternativa más simple (opción b del revisor): no cambia nada del marcado existente que ya está probado. | Hallazgo 11 (anuncios equivalentes sin contexto) y evitar reanuncios durante el sondeo, sin tocar los mensajes que los tests y la documentación citan. |

Dudas menores resueltas con la alternativa más simple: (1) la sección `Prueba` se abre automáticamente después de una validación correcta solo si la campaña no tiene todavía ninguna fila `Email Sent` conocida por el cliente; como el cliente no lo sabe, se abre siempre `Prueba` con la ayuda "La prueba es opcional; podés pasar a Envío" y un botón secundario `Ir a Envío` (`id="skip-test"`) que solo abre el paso 4; (2) el botón `Cerrar` (id `close`) pasa a la cabecera como botón secundario con texto `Cerrar` (la documentación lo cita); (3) `progress-truncated` conserva su texto; (4) el número de fila de la prueba sigue siendo un `<input type="number">` con `min="2"`, y se agrega la ayuda `hint-test-row` con las filas candidatas tomadas de la última `ValidationView` (`rows[].rowNumber` y `email`, hasta 5, luego `y N más`), que es un dato real.

## Contratos

### Estado del cliente (ampliación)

```js
var state = {
  busy: { config: true, validation: false, test: false, send: false },
  setupHeaderKey: null,
  confirmations: { test: null, send: null },
  run: null,
  // nuevo
  panel: null,            // último PanelState recibido (sheets, drafts, senders, current)
  configSaved: false,     // true tras un saveConfig exitoso en esta sesión, o si panel.current no es null
  lastValidation: null,   // última ValidationView recibida (se borra al guardar configuración)
  lastResult: null,       // última SendResultView ok (para el resumen del paso 4 y la consola)
  transportFailed: false, // falla de transporte de execute… (D-45); se limpia en startRun(), junto con la guía
  openStep: 1             // 1..4, o 5 para la consola
};
```

`state.panel` se asigna en `onPanelState` y queda `null` si `getPanelState` falla: `derivePhase()` y `hintsFor()` tratan `state.panel === null` como "sin borradores conocidos" sin leer `panel.drafts` ni `panel.current` (evita un `TypeError` en el caso borde "`getPanelState` falla"). `configSaved` se pone en `true` en `onPanelState` cuando `panel.current !== null` (`getPanelState_` devuelve `current: null` sin configuración) y en el éxito de `saveConfig`. Los selects `sheet`, `draft` y `from` suman un `change` → `refreshControls` (evento ya permitido por el DOM falso) para que la fase refleje un select vaciado sin esperar otra acción.

### `derivePhase(state)` → fase

| Condición (en orden) | Fase |
|---|---|
| `running()` | `enviando` |
| `liveConfirmation('send')` | `revisando-envio` |
| `liveConfirmation('test')` | `revisando-prueba` |
| `state.transportFailed` | `incierta` |
| `state.lastResult` | `terminada` |
| `!state.configSaved` o algún select vacío o `state.panel === null` o `state.panel.drafts.length === 0` | `sin-configurar` |
| `!state.lastValidation` | `configurada` |
| `lastValidation.setup && lastValidation.setup.needed` | `preparar-columnas` |
| `lastValidation.globalErrors.length > 0` o `counts.valid === 0` | `bloqueada` |
| en otro caso | `lista` |

Mapa fase → paso abierto por defecto, botón primario y chips: `sin-configurar` → paso 1, `save`; `configurada` → paso 2, `validate`; `preparar-columnas` → paso 2, `apply-setup`; `bloqueada` → paso 2, `validate`; `lista` → paso 3, `review-test` (con `skip-test` secundario); `revisando-prueba` → paso 3, `execute-test`; `revisando-envio` → paso 4, `execute-send`; `enviando` → consola, ninguno; `terminada` → consola, `review-send` secundario en el paso 4; `incierta` → consola, ninguno. El botón primario recibe `className = 'btn btn--primary'`; los demás botones de acción, `'btn'`; los de cancelar, `'btn btn--ghost'`. Nada de esto cambia `disabled`, que sigue saliendo de `refreshControls()`.

Las confirmaciones vivas van antes que `incierta` porque `transportFailed` dura hasta el próximo `startRun()` (igual que la guía visible): así un `prepare…` nuevo tras una falla de transporte da `revisando-*`, y si se cancela o vence se vuelve a `incierta` mientras la guía sigue en pantalla. `lastResult` se borra al guardar configuración y en `startRun()`; por eso, después de una prueba o un envío terminados, cancelar, vencer o un rechazo (`ok: false`) vuelven a `terminada` (no a `lista`) hasta la próxima ejecución o el próximo guardado.

Regla de apertura automática: `renderPhase()` abre el paso por defecto solo cuando la fase cambia, y **no** lo hace cuando la fase anterior era `revisando-prueba`, `revisando-envio` o `enviando` y la nueva no es `terminada` ni `incierta` (cancelar, vencer, rechazo de `execute…` con `ok: false`): en esos casos queda abierto el paso de origen (3 o 4) para que su `test-message` / `send-message` con el motivo siga visible. `onRunFinished` con `!result.ok` llama explícitamente a `openStep(run.kind === 'test' ? 3 : 4, true)` después de `refreshControls()`. Un rechazo de `prepare…` no cambia de fase y no mueve nada.

### `hintsFor(phase, data)` → lista de ids `hint-*` visibles

| Id | Se muestra cuando | Texto (resumen; el texto completo va en el marcado) |
|---|---|---|
| `hint-welcome` | `sin-configurar`, `state.panel !== null` y `state.panel.current === null` (si `getPanelState` falló, no se muestra) | Bienvenida de primera apertura: cuatro pasos, nada se envía sin confirmación |
| `hint-no-drafts` | `state.panel !== null` y `state.panel.drafts.length === 0` | Creá un borrador en Gmail con `{{Encabezado}}` y volvé a abrir el panel |
| `hint-configured` | `configurada` | Validá antes de enviar; la validación no escribe nada |
| `hint-setup` | `preparar-columnas` sin `setup.errors` | Qué hace "Preparar columnas" y que solo toca la fila 1 |
| `hint-setup-blocked` | `setup.errors.length > 0` | Resolvé a mano según la tabla de bloqueos de la guía |
| `hint-quota-unknown` | `quotaRemaining === null` | Cuota no disponible: el envío puede cortarse |
| `hint-quota-short` | `typeof quotaRemaining === 'number' && quotaRemaining < counts.valid` (en JS `null < n` es `true`: sin el `typeof` se mostraría junto con `hint-quota-unknown`) | Se enviarán como mucho N; el resto queda pendiente para otro día (N por `textContent` en `hint-quota-short-n`) |
| `hint-all-excluded` | `counts.valid === 0 && counts.excluded > 0 && globalErrors.length === 0` | Todas las filas están excluidas: revisá `Resultado`, filas ocultas y filtros |
| `hint-overwrite` | `overwriteRows.length > 0` (validación) | Suelen ser filas con prueba previa; la confirmación pedirá consentimiento |
| `hint-test-optional` | `lista` | La prueba es opcional y deja `Resultado = Email Sent` en la fila probada |
| `hint-test-row` | `lista` y `rows.length > 0` | Filas candidatas: `2 (ana@…), 3 (…)` y N más (la parte variable va por `textContent` en `hint-test-row-list`, un `<span>` con `id` dentro del párrafo estático) |
| `hint-filter-views` | `revisando-envio` | Las vistas de filtro no excluyen filas (texto actual de la ayuda de la sección Envío) |
| `hint-consent` | `consentRequired` | Qué columnas se reemplazan y que los valores no se recuperan desde la herramienta |
| `progress-truncated` | `rowsTruncated` | Es el `progress-truncated` actual (mismo `id`, sin elemento `hint-truncated` nuevo; lo sigue alternando `renderProgress`) |
| `hint-review` | `terminada` y `counts.review > 0` | Pasos de conciliación de `ENVIANDO` / `REVISAR` (los cinco pasos de la guía, resumidos) |
| `hint-pending` | `terminada` y `counts.pending > 0` | Siguen elegibles: volvé a Revisar envío |
| `hint-uncertain` | `incierta` | Complementa la guía de D-45: no reenviar sin revisar la hoja |
| `hint-test-done` | `terminada` y `state.run.kind === 'test'` | Para el envío real hay que vaciar `Resultado` de la fila probada si se quiere incluirla (texto de la guía, "Envío de prueba") |

### DOM falso (D-50): API resultante

Lectura: `ELEMENT_READ` + `setAttribute`, `getAttribute`, `removeAttribute`, `focus`, `blur`. Escritura: sin cambios. `setAttribute(name, value)` lanza si `name` no coincide con `^(aria-[a-z]+|role)$`; guarda `String(value)`. `getAttribute(name)` devuelve el texto o `null`. `removeAttribute(name)` borra. El parser conserva los atributos `aria-*` y `role` estáticos de los elementos con `id`. `focus()` registra `node.id` en `focused` (último), `blur()` lo vacía; `loadSidebar()` devuelve además `focusedId()` y `attribute(id, name)`. El test `fake-dom: document y los elementos lanzan fuera del subconjunto permitido` agrega: `setAttribute('href', …)`, `setAttribute('onclick', …)`, `setAttribute('style', …)`, `setAttribute('data-x', …)` lanzan; `classList`, `dataset`, `createElementNS`, `addEventListener('input')` lanzan; `setAttribute('aria-expanded', 'true')` y `focus()` funcionan.

Agregar los nombres a `ELEMENT_READ` no alcanza: el `get` del `Proxy` de `makeElement` devuelve `node[prop]` en su rama `default`, así que hay que sumar `setAttribute`, `getAttribute`, `removeAttribute`, `focus` y `blur` al `case` que devuelve `api[prop]` (junto a `appendChild`, `removeChild`, `addEventListener`, `add`). `node.attributes` se inicializa en `makeElement` para todo nodo (también los de `createElement` y `new Option`), y `focused` es una variable de `loadSidebar()` que comparten todos los nodos. El atributo de lectura estática no colisiona con `id`: `attribute(attrs, 'id')` exige `\sid=`, que `aria-controls="…"` no cumple.

### Vista previa local (D-59)

`tools/preview-sidebar.js` (CommonJS, solo `node:fs` y `node:path`): `node tools/preview-sidebar.js [estado]` escribe `tmp/sidebar-preview.html`. El HTML generado es `src/Sidebar.html` con un `<script>` adicional insertado antes del original que define `window.google = { script: { run: <falso>, host: { close() {} } } }`. El falso resuelve cada llamada de forma asíncrona (`setTimeout` de 400 ms, solo en la vista previa) con las vistas de `tests/fixtures/sidebar-views.js` según el estado elegido por `location.search` (`?state=inicial|sin-borradores|configurada|setup|bloqueada|lista|prueba|envio|consentimiento|enviando|terminada|revisar|incierta`) y ofrece una barra fija fuera del panel (ancho total 300 px para el panel) para cambiar de estado. Los fixtures son datos ficticios (`example.test`). El archivo `tmp/` está en `.gitignore`. La vista previa no se prueba con tests (es una herramienta manual), pero `node --check tools/preview-sidebar.js` forma parte de la verificación.

Como `tests/fixtures/sidebar-views.js` es CommonJS y no corre en el navegador, `tools/preview-sidebar.js` lo carga con `require`, arma en Node las respuestas de cada estado y las incrusta como JSON en el `<script>` insertado, reemplazando cada `<` por la secuencia literal `<` (seis caracteres: barra invertida, `u003c`; JSON válido que el navegador decodifica a `<` al parsearlo) (los fixtures incluyen textos con marcado como `<b>x</b>`, y un `</script>` literal cortaría el bloque). `expiresAtIso` no se congela en la generación: el JSON lleva minutos relativos y el `<script>` de la vista previa calcula la fecha al cargar, para que una vista previa abierta más tarde no muestre la confirmación ya vencida. Los estados que requieren recorrer el flujo (`prueba`, `envio`, `enviando`, `terminada`, `revisar`, `incierta`) los alcanza el operador con los botones reales del panel; el falso solo decide qué responde cada función según `?state=`.

`tests/fixtures/sidebar-views.js` exporta `panelState(overrides)` (con variantes `current: null` y `drafts: []` para las fases `sin-configurar`), `validationView(variant)`, `confirmationView(kind, variant)`, `progress(variant)`, `sendResult(variant)` con los mismos datos que hoy construye `tests/sidebar.test.js` (que sigue usando sus funciones locales; no se refactoriza para no tocar tests existentes).

## Arquitectura de presentación

```text
src/Sidebar.html
├── <head>: <base target="_top">, <meta charset>, <style>
│   ├── tokens (:root color-scheme: dark; --bg --surface --surface-2 --line --text --muted --accent --warn --danger --focus --radius --space-*)
│   ├── reset mínimo, tipografía del sistema, [hidden]{display:none !important}
│   ├── primitivas: .btn (.btn--primary .btn--ghost .btn--danger), .card, .chip (.chip--ok --warn --danger --muted --live),
│   │   .tile, .meter, .gate, .step, .rail, .hint, .ic-* (iconos por mask), .log (tabla apilada)
│   ├── layout 300 px: cabecera, acordeón, consola, pie
│   └── @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none; animation: none } }
├── <body>
│   ├── <header class="brand">  logo SVG + "Mail Merge ZB" + "Eclipse Console" + botón Cerrar (id close) + riel (id rail: 4 puntos con id rail-1..rail-4)
│   ├── <p id="status-live" role="status" aria-live="polite" class="sr-only">  anuncio global (fase y progreso)
│   ├── <section class="step" id="section-campaign">
│   │   ├── <button id="step-1-toggle" aria-expanded aria-controls="step-1-body"> 1 · Campaña · <span id="step-1-summary"> · <span id="step-1-chip">
│   │   └── <div id="step-1-body">  (formulario actual, ids intactos) + hint-welcome, hint-no-drafts, hint-configured
│   ├── <section class="step" id="section-validation">  step-2-* + Radar: tiles (id tile-valid, tile-invalid, tile-excluded, tile-quota), meter (id meter-valid, meter-invalid, meter-excluded), validation-result, setup-box, hints
│   ├── <section class="step" id="section-test">  step-3-* + test-row, review-test, skip-test, test-confirmation (Safe Send Review de prueba), hints
│   ├── <section class="step" id="section-send">  step-4-* + review-send, send-confirmation (Safe Send Review: card de aviso, resumen, chips de adjuntos, lista, <fieldset class="gate"> con send-filter-ack y send-consent-box, execute-send, cancel-send), hints
│   └── <section class="console" id="progress-section">  título Progreso y resultados, progress-status, tiles de contadores (ids count-*), progress-bar, progress-guidance (role=alert), stopped-reason (role=alert), summary, progress-truncated, <table class="log"> con results-body, hint-review, hint-pending, hint-uncertain
└── <script>  MailMergePanel (IIFE): utilidades → estado → derivePhase → hintsFor → renderers → refreshControls → eventos → loadPanel()
```

Reglas de marcado: cada `id` una sola vez y entre comillas dobles; ningún `>` dentro de valores de atributos; ningún `<svg>` con `id`; los textos que el script escribe van en elementos con `id` propios (`step-N-summary`, `step-N-chip`, `tile-*-value`, `meter-*`), nunca en contenedores con SVG; `type="button"` en todos los botones; `label for` en cada control; `aria-describedby` estático hacia las ayudas fijas del formulario.

## Wireframes de los estados principales (300 px)

### Primera apertura (`sin-configurar`, `current === null`)

```text
┌──────────────────────────────────────┐
│ ◐ MAIL MERGE ZB              Cerrar  │
│   Eclipse Console       ① ○ ○ ○      │
│──────────────────────────────────────│
│ 1  Campaña                Sin guardar│
│    ┌ ✦ Bienvenido. Cuatro pasos: ──┐ │
│    │ configurar, validar, probar y │ │
│    │ enviar. Nada sale sin tu      │ │
│    │ confirmación.                 │ │
│    └───────────────────────────────┘ │
│    Pestaña de la campaña             │
│    [ Elegí una opción…           ▾ ] │
│    Borrador de Gmail (plantilla)     │
│    [ Elegí una opción…           ▾ ] │
│    Remitente                         │
│    [ Elegí una opción…           ▾ ] │
│    Reply-To (opcional)               │
│    [                               ] │
│    Nombre de campaña (opcional)      │
│    [                               ] │
│    [ Guardar ]            ← primario │
│──────────────────────────────────────│
│ 2  Validación              Pendiente │
│ 3  Prueba                  Pendiente │
│ 4  Envío                   Pendiente │
└──────────────────────────────────────┘
```

### Preflight Radar (`lista`, con aviso de sobrescritura)

```text
┌──────────────────────────────────────┐
│ ◐ MAIL MERGE ZB              Cerrar  │
│   Eclipse Console       ● ② ○ ○      │
│──────────────────────────────────────│
│ 1  Campaña · Q4 lanzamiento   Lista ▸│
│──────────────────────────────────────│
│ 2  Validación                  Lista │
│    [ Validar ]                       │
│    ✓ Validación sin errores globales.│
│    ┌────────┬────────┬────────┐      │
│    │ 42     │ 3      │ 5      │      │
│    │ELEGIBLE│ERRORES │EXCLUID.│      │
│    └────────┴────────┴────────┘      │
│    ████████████████████▒▒▒░░░        │
│    ◔ Cuota diaria restante   1 450   │
│    Pestaña  Campaña otoño            │
│    Asunto   Novedades de noviembre   │
│    Adjuntos del borrador             │
│    [catalogo.pdf]                    │
│    ▾ Excluidas por motivo (5)        │
│      resultado: Email Sent      3    │
│      fila oculta                2    │
│    ▾ Filas con errores (3)           │
│      Fila 5: Email Address inválido  │
│    ⚠ Al enviar se reemplazarán …     │
│      fila 2 (Fecha, Detalle)         │
│    ▾ Filas a enviar (42)             │
│      Fila 2 → ana@cliente.com: a.pdf │
│      …                               │
│──────────────────────────────────────│
│ 3  Prueba                  Pendiente │
│ 4  Envío                   Pendiente │
└──────────────────────────────────────┘
```

Los grupos "▾" son `<details>`-like hechos con un botón `type="button"` con `id` (`toggle-excluded`, `toggle-invalid`, `toggle-rows`) y `aria-expanded`, abiertos por defecto en errores y filas a enviar; cerrados por defecto solo las exclusiones por motivo. En la confirmación (paso 4) no hay grupos colapsables.

### Safe Send Review (`revisando-envio`, con consentimiento)

```text
┌──────────────────────────────────────┐
│ ◐ MAIL MERGE ZB              Cerrar  │
│   Eclipse Console       ● ● ● ④      │
│ 1  Campaña · Q4 lanzamiento   Lista ▸│
│ 2  Validación · 42 elegibles  Lista ▸│
│ 3  Prueba · fila 2 enviada    Hecha ▸│
│──────────────────────────────────────│
│ 4  Envío                    Revisión │
│  ┌ ⚠ Se enviarán 42 correos reales.┐ │
│  │   Esta acción no se puede       │ │
│  │   deshacer.                     │ │
│  └─────────────────────────────────┘ │
│    Campaña    Q4 lanzamiento         │
│    Pestaña    Campaña otoño          │
│    Asunto     Novedades de noviembre │
│    Remitente  ventas@empresa.com     │
│    42 a enviar · 3 con errores ·     │
│    5 excluidas                       │
│    Adjuntos del borrador             │
│    [catalogo.pdf]                    │
│    DESTINATARIOS (42)                │
│    Fila 2 → ana@cliente.com: a.pdf   │
│    Fila 3 → luis@otro.com            │
│    …                                 │
│    Fila 47 → zoe@cliente.com         │
│    ── fin de la lista (42) ──        │
│  ┌ VERIFICACIÓN ───────────────────┐ │
│  │ ☐ Revisé todos los destinatarios│ │
│  │   listados. Entiendo que las    │ │
│  │   vistas de filtro …            │ │
│  │ ☐ Acepto que se reemplacen …    │ │
│  │   · fila 2 (Fecha, Detalle)     │ │
│  └─────────────────────────────────┘ │
│    ⏱ Vence a las 15:42 (10 min)      │
│    Falta: marcar las 2 casillas      │
│    [ Cancelar ]  [ ⇪ Enviar 42 correos ]│
└──────────────────────────────────────┘
```

`Falta: …` es `id="send-gate-status"` y refleja por `textContent` qué compuerta falta (`marcar las 2 casillas`, `marcar la casilla de filtros`, `marcar el consentimiento`, vacío cuando el botón está habilitado). En la prueba, `id="test-gate-status"` y la línea `Para: <cuenta>` destacada.

### Live Execution Console (`enviando`)

```text
┌──────────────────────────────────────┐
│ ◐ MAIL MERGE ZB              Cerrar  │
│   Eclipse Console       ● ● ● ●      │
│ 1 · 2 · 3 · 4 colapsados, chips Hecha│
│──────────────────────────────────────│
│ ● Progreso y resultados   Enviando…  │
│   Enviando: 12 de 42                 │
│   ████████████░░░░░░░░░░░░░░░░ 12/42 │
│   ┌──────┬──────┬──────┐             │
│   │ 42   │ 12   │ 11   │             │
│   │TOTAL │PROC. │ACEPT.│             │
│   ├──────┼──────┼──────┤             │
│   │ 1    │ 0    │ 30   │             │
│   │OMIT. │REVIS.│PEND. │             │
│   └──────┴──────┴──────┘             │
│   Fila 12  ✓ Email Sent              │
│            ana@cliente.com           │
│            Aceptado por Gmail        │
│   Fila 11  – OMITIDA                 │
│            luis@otro.com             │
│            Cambió después de la …    │
│   …                                  │
└──────────────────────────────────────┘
```

Los tiles llevan la etiqueta completa (`Total`, `Procesadas`, `Aceptadas por Gmail`, `Omitidas`, `Para revisar`, `Pendientes`) en texto; la abreviatura del boceto es solo del dibujo. `Para revisar` con valor > 0 pasa a `tile--warn`.

### Resultado con conciliación (`terminada`, `counts.review > 0`)

```text
┌──────────────────────────────────────┐
│ ● Progreso y resultados  Terminado   │
│   Envío terminado.                   │
│   ██████████████████████████████ 42/42│
│   (tiles)                            │
│   ┌ ! 2 filas requieren conciliación┐│
│   │ 1. Leé Detalle de la fila.      ││
│   │ 2. Buscá el correo en Enviados. ││
│   │ 3. Está → Email Sent; no está → ││
│   │    vaciá Resultado; duda → SKIP ││
│   └─────────────────────────────────┘│
│   Campaña: Q4 lanzamiento            │
│   40 correos aceptados por Gmail     │
│   Filas procesadas: 42 de 42         │
│   Fila 17 (REVISAR): Gmail lanzó …   │
│   Fila 17  ! REVISAR                 │
│            …                         │
│   [ Revisar envío ]   ← secundario   │
└──────────────────────────────────────┘
```

## Archivos afectados

| Archivo | Cambio |
|---|---|
| `tests/helpers/fake-dom.js` | D-50: `setAttribute`/`getAttribute`/`removeAttribute` con lista blanca, `focus`/`blur`, lectura de `aria-*`/`role` estáticos, `focusedId()`, `attribute(id, name)`; comentario de cabecera actualizado |
| `tests/sidebar.test.js` | Solo el test `fake-dom: document y los elementos lanzan fuera del subconjunto permitido` (ampliado). Ningún otro test cambia |
| `tests/sidebar-console.test.js` (nuevo) | Tests de Eclipse Console: fases, acordeón, riel, radar, compuertas, consola, ayudas, foco, atributos ARIA, contraste |
| `tests/fixtures/sidebar-views.js` (nuevo) | Vistas ficticias compartidas por los tests nuevos y la vista previa |
| `tests/ui.test.js` | Tests estáticos nuevos sobre `src/Sidebar.html`: un solo `<script>`, sin `<link>`/`@import`/`url(http`, sin `setInterval`/`requestAnimationFrame`, `color-scheme`, `[hidden]` con `!important`, ningún `<svg` con `id=`, `prefers-reduced-motion` presente. Los tests existentes no cambian |
| `src/Sidebar.html` | Reescritura de la capa de presentación (marcado, CSS, renderers) conservando ids, literales, contrato y reglas del cliente |
| `tools/preview-sidebar.js` (nuevo) | Vista previa local (D-59) |
| `.gitignore` | Sin cambios (`tmp/` ya está ignorado) |
| `README.md` | Identidad, qué hace, capturas (cuando existan), instalación reproducible como script vinculado, vista previa local, estructura |
| `docs/OPERATIONS.md` | Sección "El panel Mail Merge" reescrita para Eclipse Console (pasos, riel, radar, compuertas, consola, ayudas), checklist en vivo ampliada (ítems 22 a 26) |
| `docs/ACCEPTANCE_STATUS.md` | AC-56 a AC-64 con sus tests, resultado real de la suite, evidencia de la vista previa (descripta, no capturada) |
| `docs/DECISIONS.md` | D-49 a D-60 y la modificación de D-25 en lo que respecta a presentación |
| `docs/PRODUCT.md` | Una línea en "Chosen defaults": la sidebar es la única interfaz y su diseño es Eclipse Console (D-49) |
| `plans/2026-11-09_mail-merge-v2.md` | Nota al inicio de "Detalle del código > Sidebar": reemplazada en lo visual por este plan (D-49); corrección de la tabla de funciones públicas: `executeSendPending(token, overwriteConsent, filterAcknowledged)` (tres argumentos, S-02) |
| `AGENTS.md` | Estado del proyecto: agrega este plan como diseño vigente de la interfaz |

Sin cambios: `src/*.js`, `src/appsscript.json`, `tests/*.test.js` salvo los indicados, `tests/helpers/fakes.js`, `tests/helpers/load-apps-script.js`, `tests/fixtures/campaign.js`.

## Detalle del código

### `tests/helpers/fake-dom.js` (D-50)

```js
const ATTRIBUTE_NAME = /^(aria-[a-z]+|role)$/;
// en makeElement: node.attributes = {}; init.attributes copia los aria-*/role estáticos del marcado
// en api:
setAttribute(name, value) {
  if (!ATTRIBUTE_NAME.test(String(name))) throw new Error(`Sidebar: atributo no permitido "${name}"`);
  node.attributes[name] = String(value);
},
getAttribute(name) { return Object.prototype.hasOwnProperty.call(node.attributes, name) ? node.attributes[name] : null; },
removeAttribute(name) { delete node.attributes[name]; },
focus() { focused = node.id; },
blur() { if (focused === node.id) focused = ''; },
```

`ELEMENT_READ` suma `setAttribute`, `getAttribute`, `removeAttribute`, `focus`, `blur`. El parser extrae con una expresión `\s(aria-[a-z]+|role)\s*=\s*"([^"]*)"` global sobre `attrs` de cada elemento con `id`. El objeto devuelto suma `focusedId()` y `attribute(id, name)`.

### `src/Sidebar.html`: utilidades nuevas

```js
function setClass(node, base, mods) {            // className completo, sin classList
  var names = [base];
  Object.keys(mods || {}).forEach(function (key) { if (mods[key]) { names.push(key); } });
  node.className = names.join(' ');
}
function setAria(node, name, value) { node.setAttribute(name, String(value)); }   // solo aria-*/role
function focusNode(node) { node.focus(); }
function formatTime(iso) {                        // "15:42"; vacío si la fecha es inválida
  var date = new Date(iso);
  if (isNaN(date.getTime())) { return ''; }
  var h = date.getHours(), m = date.getMinutes();
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}
function rowStatusClass(result) {                 // lista cerrada (D-55)
  switch (asText(result)) {
    case 'Email Sent': return 'row row--sent';
    case 'OMITIDA':    return 'row row--skipped';
    case 'NO ENVIADA': return 'row row--notsent';
    case 'ENVIANDO':   return 'row row--sending';
    case 'REVISAR':    return 'row row--review';
    default:           return 'row row--neutral';
  }
}
```

### Acordeón y riel

```js
var STEPS = [1, 2, 3, 4];
function openStep(n, moveFocus) {                 // 1..4; 5 = consola
  state.openStep = n;
  STEPS.forEach(function (i) {
    var toggle = byId('step-' + i + '-toggle');
    var open = i === n || toggle.disabled;      // un paso con toggle disabled (confirmación viva) nunca se cierra (D-57)
    byId('step-' + i + '-body').hidden = !open;
    setAria(toggle, 'aria-expanded', open ? 'true' : 'false');
    setClass(toggle, 'step__toggle', { 'is-open': open });
  });
  if (moveFocus) { focusNode(byId(n <= 4 ? 'step-' + n + '-toggle' : 'console-title')); }
}
function renderRail(phase) {                      // chips y riel desde la fase y el estado
  // rail-i: className 'rail__dot' + 'is-done' | 'is-current' | 'is-locked'; aria-current="step" en el actual
  // step-i-chip: textContent 'Sin guardar' | 'Lista' | 'Pendiente' | 'Bloqueada' | 'Preparar' | 'Revisión' | 'Hecha' | 'Vencida' | 'Enviando'
  // step-i-summary: 'Q4 lanzamiento' | '42 elegibles · 3 errores' | 'fila 2 enviada' | '42 correos'
}
```

Los toggles de paso escuchan `click` y llaman a `openStep(i, false)`, salvo cuando `toggle.disabled` (D-57). El toggle del paso 3 queda `disabled` mientras `liveConfirmation('test')`, el del paso 4 mientras `liveConfirmation('send')`, y la consola no tiene toggle. `refreshControls()` llama al final a `renderPhase()`, que calcula `derivePhase(state)`, pinta riel, chips, resúmenes, botón primario, `send-gate-status` / `test-gate-status`, las ayudas (`hintsFor`) y, si la fase cambió respecto de la anterior, abre el paso por defecto de la fase con foco (`openStep(n, true)`) y escribe el anuncio en `status-live` (`'Paso 2: Validación'`, `'Confirmación lista: 42 destinatarios'`, `'Enviando: 12 de 42'`, `'Envío terminado'`). El cambio de fase no abre un paso si el operador ya lo abrió manualmente en la misma fase, ni en las transiciones de salida descriptas en "Regla de apertura automática". `renderPhase()` asigna el `disabled` de los toggles **antes** de llamar a `openStep()`, que lo lee. Los toggles no son botones de acción: el test «D-56: las fases no cambian disabled…» compara solo los botones que ya gobierna `refreshControls()`. Al cargar, `loadPanel()` llama a `refreshControls()` antes de la respuesta (fase `sin-configurar`, paso 1) y `onPanelState` puede cambiarla (por ejemplo a `configurada`, paso 2): son dos aperturas con foco esperadas; los tests de foco miran el estado después de resolver `getPanelState`.

### Radar (paso 2)

`renderValidation(view)` conserva su salida de texto en `validation-result` (los tests buscan `Fila 2 → …`, `Fila 5: …`, `resultado: Email Sent`, `95`, `fila 3 (Campaña)`) y además escribe: `tile-valid-value`, `tile-invalid-value`, `tile-excluded-value` con los conteos; `tile-quota-value` con `quotaRemaining` o `no disponible`; `meter-valid`, `meter-invalid`, `meter-excluded` con `className` fijo y `textContent` del conteo (la barra segmentada se dibuja con `flex-grow` en CSS a partir de un `className` de ancho discreto: `w-0 … w-10` en décimos, calculado como `Math.round(10 * n / total)`; sin `style`). El mensaje de validación pasa a `'La validación encontró problemas: ' + globalErrors.length + ' globales · ' + counts.invalid + ' filas con errores'` cuando `!view.ok`, y conserva `'Validación sin errores globales.'` cuando `view.ok`. Los grupos colapsables `toggle-excluded`, `toggle-invalid`, `toggle-rows` alternan `hidden` de `group-excluded`, `group-invalid`, `group-rows` y `aria-expanded`; `group-rows` y `group-invalid` nacen abiertos. `renderSetup(setup)` pinta el plan de columnas como lista "diff": renombres con prefijo `~`, agregados con `+`, bloqueos con `!` (texto, no icono), sin cambiar el texto que el test busca (`Renombrar "…" → "…" (columna B)`).

Estructura de `validation-result`: hoy `renderValidation` hace `clear(el.validationResult)`, que en un navegador real desprendería del documento cualquier elemento estático que viva dentro (toggles, grupos, tiles), dejando referencias muertas en `el` y `byId()` devolviendo `null`. Por eso `validation-result` pasa a ser un contenedor estático que **no se vacía**: contiene los tiles, el meter, un `<div id="validation-lines">` para las líneas generales (errores globales, pestaña, asunto, remitente, Reply-To, cuota, conteos, adjuntos comunes, aviso de sobrescritura) y los grupos `group-excluded`, `group-invalid`, `group-rows` con sus toggles; `renderValidation` vacía solo `validation-lines` y los tres `group-*`. Todo texto que los tests buscan con `text('validation-result')` (`Fila 2 → alpha@example.test: a.pdf`, `Fila 5: Email Address inválido`, `resultado: Email Sent`, `95`, `fila 3 (Campaña)`, `encabezados de la versión anterior`, `<b>x</b>`, `<img src=y>`) sigue siendo descendiente de `validation-result`; se conserva la línea de texto `Cuota diaria restante de Gmail: N` además del tile. Los toggles y grupos son marcado estático (no `createElement`), así que la validación sigue sin crear `<input>`. La misma regla vale para `send-view` / `test-view`: lo que el script vacía con `clear()` no contiene elementos estáticos con `id`.

### Safe Send Review (pasos 3 y 4)

`renderConfirmation(kind, view)` conserva el contenido textual de `test-view` / `send-view` (líneas actuales) y agrega al final de la lista de filas una línea `'── fin de la lista (' + count + ') ──'`; muestra `Vence a las HH:MM (10 min)` en lugar de `La confirmación vence: <toLocaleString()>` (ninguna prueba ni documento cita el formato anterior; `docs/OPERATIONS.md` dice "la hora en que vence la confirmación (10 minutos)", que sigue siendo cierto). Las casillas conservan sus ids y su `label`, dentro de `<fieldset class="gate"><legend>Verificación</legend>`. `gateStatus(kind)` devuelve el texto para `send-gate-status` / `test-gate-status`: en `send`, `'Falta: marcar las 2 casillas'` si faltan las dos, `'Falta: marcar la casilla de filtros'`, `'Falta: marcar el consentimiento'`, o `''`; en `test`, solo el consentimiento; sin confirmación viva (cancelada, vencida, usada o inexistente) devuelve `''`. `refreshControls()` lo actualiza en cada cambio de casilla. El botón `execute-*` recibe `className` `btn btn--primary btn--send` (icono por CSS) y su `textContent` sigue siendo exactamente `Enviar prueba` / `Enviar 1 correo` / `Enviar N correos`.

### Consola (progreso y resultados)

`setCounters(counts)` conserva los ids `count-*` y agrega `progress-fraction` (`'12/42'`) y el `className` `tile tile--warn` en `tile-review` cuando `review > 0`. `renderRows(rows, recipientOf)` conserva la tabla y asigna a cada `<tr>` `className = rowStatusClass(row.result)`; el chip de estado es el `<td>` de `Resultado` estilizado por CSS. `renderProgress` escribe `status-live` con `'Enviando: ' + processed + ' de ' + total` solo si `processed` cambió. `onRunFinished` conserva sus textos y además guarda `state.lastResult`, abre la consola (`openStep(5, true)` con foco en el título `id="console-title"`, que tiene `tabindex="-1"` estático) y muestra `hint-review` / `hint-pending` según los conteos. `onRunFailed` marca `state.transportFailed = true` (se limpia en `startRun()`, en el mismo punto donde hoy se oculta la guía) y conserva la guía. `startRun()` también borra `state.lastResult`. En `!result.ok` se vuelve al paso 4 (o 3) con el mensaje en `send-message` / `test-message`, como hoy, mediante el `openStep(…, true)` explícito de la "Regla de apertura automática" (sin él, la fase nueva abriría el paso 2 o 3 y ocultaría el motivo).

### CSS (extracto normativo)

```css
:root { color-scheme: dark; --bg:#0F1117; --surface:#1A1D24; --surface-2:#22262F; --line:#2A2F3A; --text:#E5E7EB; --muted:#9CA3AF; --accent:#10B981; --accent-ink:#0F1117; --warn:#FBBF24; --danger:#F87171; --focus:#E5E7EB; --radius:6px; --font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--bg); color: var(--text); font: 13px/1.45 var(--font); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.btn--primary:focus-visible { outline-color: var(--focus); }
.btn { min-height: 36px; border-radius: var(--radius); border: 1px solid var(--line); background: var(--surface-2); color: var(--text); }
.btn--primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.btn--send { min-height: 44px; }
.btn--ghost { background: transparent; }
.gate { border: 1px solid var(--warn); border-radius: var(--radius); }
.log tr, .log td { display: block; }  .log thead { position: absolute; left: -9999px; }  /* tabla apilada (D-55) */
.log td:nth-child(1)::before { content: "Fila "; color: var(--muted); }
@media (prefers-reduced-motion: no-preference) { .step__body { transition: opacity .15s ease; } .rail__dot.is-current { animation: pulse 2s ease-in-out infinite; } }
.ic::before { content: ""; display: inline-block; width: 16px; height: 16px; background-color: currentColor; -webkit-mask-image: var(--ic); mask-image: var(--ic); -webkit-mask-size: contain; mask-size: contain; }  /* iconos por CSS (D-54), con respaldo -webkit- para Chromium anterior a 120 */
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; animation: none !important; } }
```

Pares de contraste que AC-62 verifica (ratio ≥ 4.5:1 para texto, ≥ 3:1 para `--accent` sobre superficies como indicador): `--text`/`--bg`, `--text`/`--surface`, `--text`/`--surface-2`, `--muted`/`--bg`, `--muted`/`--surface`, `--muted`/`--surface-2`, `--accent`/`--surface`, `--warn`/`--surface`, `--danger`/`--surface`, `--accent-ink`/`--accent`. Está prohibido definir un token de texto por debajo de 4.5:1 sobre cualquier superficie (en particular `#6B7280`).

## Qué no cambia

- Lógica de negocio, servicios, confirmación por token, motor de envío, migración de columnas, validación, adjuntos, plantilla, límites, scopes, manifest, menú y título.
- Reglas del cliente del plan V2: una operación de servidor por sección, `execute…` una vez por token, sondeo encadenado, descarte local antes de `cancelConfirmation`, vencimiento por `expiryTimer`, vuelta al estado inicial ante rechazo, bloqueo con `disabled` real.
- Los 32 tests de `tests/sidebar.test.js` (salvo la ampliación del test del helper) y todos los demás tests.
- `tests/helpers/fakes.js`, `tests/helpers/load-apps-script.js`, `tests/fixtures/campaign.js`.
- Permisos de Drive, pestaña `Registro Mail Merge`, columnas gestionadas y estados.

## Casos borde

- Panel abierto sin configuración guardada y sin borradores → fase `sin-configurar`, `hint-welcome` y `hint-no-drafts` visibles, `save` habilitado (hoy solo lo deshabilitan `busy.config` y `running()`), pero su clic no llama al servidor: el guard de `saveConfigForm` muestra `Elegí la pestaña, el borrador y el remitente.` con selects vacíos, y `config-message` conserva el aviso actual `No hay borradores en tu cuenta de Gmail…`; los pasos 2 a 4 siguen abribles a mano, y `Validar` sigue habilitado (el servidor responde el error de configuración, como hoy).
- Configuración guardada en una sesión anterior (`panel.current` no nulo) → `configSaved = true`, fase `configurada`, paso 2 abierto, botón `validate` primario.
- Guardar de nuevo la configuración → `lastValidation = null`, `lastResult = null`, fase `configurada`; el resumen del paso 2 vuelve a `Pendiente`.
- Validación con `setup.needed` y errores de bloqueo → fase `preparar-columnas`, chip `Preparar` en rojo, `apply-setup` deshabilitado (como hoy) y `hint-setup-blocked`.
- `applyColumnSetup` exitoso → revalidación automática (como hoy); la fase se recalcula al llegar la nueva vista.
- Cuota `null` → tile `no disponible` y `hint-quota-unknown`; cuota menor que las filas válidas → `hint-quota-short` con el número.
- Más de 500 filas válidas → el servidor rechaza `prepareSendPending`; la sidebar muestra el motivo en `send-message` como hoy; la fase no cambia (no hay confirmación nueva).
- Confirmación vencida → chip `Vencida`, botón deshabilitado, mensaje con «venció», toggle del paso vuelve a habilitarse, fase vuelve a la anterior a la confirmación (`lista`, `configurada`, `terminada` si hay `lastResult` o `incierta` si sigue `transportFailed`) y el paso de origen queda abierto con el mensaje (regla de apertura automática).
- Cancelar → como hoy; el paso de origen queda abierto con el mensaje de cancelación y la fase vuelve a la anterior a la confirmación (ver la fila de vencimiento).
- Rechazo del servidor en `execute…` (`ok: false`) → consola oculta, mensaje en el paso de origen abierto por `openStep` explícito, fase derivada del estado restante (`lista` o `configurada`; `lastResult` y `transportFailed` ya se borraron en `startRun()`), `lastResult` no se guarda.
- Falla de transporte → fase `incierta`, consola visible con el último progreso, guía de D-45 en `progress-guidance` (`role="alert"`), `hint-uncertain`; `transportFailed` dura hasta el próximo `startRun()` (como la guía); un `prepare…` nuevo da `revisando-*` porque las confirmaciones vivas preceden a `incierta` en `derivePhase`.
- Progreso con `rowsTruncated` → `progress-truncated` visible (texto actual).
- Resultado con `counts.review > 0` → `hint-review` y tile `Para revisar` en `tile--warn`; con `counts.pending > 0` → `hint-pending` y botón `review-send` secundario visible en el paso 4.
- Prueba terminada → fase `terminada`, resumen del paso 3 `fila N enviada`, `hint-test-done` recuerda borrar `Resultado` para el envío real (texto de la guía).
- Operador abre manualmente el paso 1 durante `revisando-envio` → permitido (el paso 4 sigue abierto, ya que un solo paso abierto es la regla por defecto, no una restricción: `openStep` cierra los demás salvo los que tienen toggle `disabled`); guardar sigue permitido (hoy `save` no depende de la confirmación) y el cliente **no** descarta la confirmación: si el operador ejecuta, el servidor la rechaza por D-43 (`ok: false`) y la sidebar vuelve al paso 4 con el motivo, como cualquier rechazo.
- Texto del servidor con marcado (`<b>x</b>`) → literal, como hoy.
- 500 filas en la confirmación → una línea por fila con `overflow-wrap: anywhere` en cada `<li>` (la línea `Fila N → email: adjuntos` es un solo texto creado por `rowLine`, no hay un nodo aparte para la dirección), adjuntos en la misma línea; sin `max-height` ni scroll interno.
- `getPanelState` falla → mensaje en `config-message`, fase `sin-configurar`, sin ayudas de bienvenida.

## Escenarios de prueba

Todos con datos ficticios, DOM falso y `google.script.run` falso. Títulos con el ID cubierto. `tests/sidebar-console.test.js` reutiliza `loadSidebar` y los fixtures de `tests/fixtures/sidebar-views.js`.

### Helper (`tests/sidebar.test.js`, test ampliado)

- «fake-dom: document y los elementos lanzan fuera del subconjunto permitido»: además de lo actual, `setAttribute('href'|'onclick'|'style'|'data-x')`, `classList`, `dataset`, `createElementNS`, `addEventListener('input')` lanzan; `setAttribute('aria-expanded','true')` + `getAttribute` devuelve `'true'`; `removeAttribute` → `null`; `focus()` → `focusedId()`; los `aria-*`/`role` estáticos del marcado se leen con `attribute(id, name)`.

### Fases y Command Center (AC-56, D-56, D-57)

- «AC-56 / D-56: al cargar sin configuración la fase es sin-configurar, el paso 1 está abierto y Guardar es el primario»: `MailMergePanel.phase() === 'sin-configurar'`, `isVisible('step-1-body')`, `!isVisible('step-2-body')`, `byId('save').className` contiene `btn--primary`, `attribute('step-1-toggle','aria-expanded') === 'true'`, `attribute('rail-1','aria-current') === 'step'`, `dom.created.length === 0`, sin temporizadores.
- «AC-56 / D-56: con configuración guardada la fase es configurada y Validar es el primario»: con `panelState()` → `'configurada'`, paso 2 abierto, `validate` primario, `text('step-1-summary') === 'Otoño 2026'`, `text('step-1-chip') === 'Lista'`.
- «AC-56 / D-57: una validación correcta abre el paso 3 con foco y resume el paso 2»: `'lista'`, `isVisible('step-3-body')`, `focusedId() === 'step-3-toggle'`, `text('step-2-summary') === '2 elegibles · 1 errores'` (según fixture), `review-test` primario, `skip-test` visible; clic en `skip-test` abre el paso 4 sin llamadas al servidor.
- «AC-56 / D-57: el toggle de un paso cerrado lo abre y el del paso con confirmación viva está deshabilitado»: tras `preparedSend`, `byId('step-4-toggle').disabled === true`; `click('step-1-toggle')` abre el paso 1 y el 4 sigue visible.
- «AC-56 / D-56: preparar columnas, bloqueada, revisando-envio, enviando, terminada e incierta se derivan del estado»: una tabla de casos que recorre cada fase con sus chips.
- «D-56: las fases no cambian disabled de ningún botón respecto de refreshControls»: para cada fase, `disabled` de los botones de acción coincide con las reglas existentes (comparación contra una tabla).
- «AC-52 (regresión): la carga sigue llamando solo a getPanelState sin temporizadores ni elementos creados» (ya cubierto; se cita como regresión).

### Radar (AC-57, D-58)

- «AC-57: los tiles muestran válidas, con errores, excluidas y cuota exactamente como la ValidationView»: `text('tile-valid-value') === '2'`, etc.; con `quotaRemaining: null` → `'no disponible'` y `hint-quota-unknown` visible.
- «AC-57 / D-58: cuota menor que las filas válidas muestra hint-quota-short con el número»; «AC-57 / D-58: todas las filas excluidas muestra hint-all-excluded».
- «AC-57: los grupos de exclusiones, errores y filas se pliegan por botón con aria-expanded y sin ocultar nada en la confirmación»: `toggle-excluded` nace `'false'`, `toggle-rows` `'true'`; en `send-view` no existe ningún toggle.
- «AC-57 / D-35: el plan de columnas se muestra como diff y Preparar columnas sigue llamando a applyColumnSetup con headerKey» (texto `Renombrar "Mail Merge Status" → "Resultado" (columna C)` conservado).
- «AC-54 / D-47 (regresión): overwriteRows sigue siendo un aviso sin casilla y la validación no crea inputs».
- «AC-57: el mensaje de validación con problemas informa los conteos».

### Safe Send Review (AC-58)

- «AC-58: la confirmación de envío muestra el aviso, el resumen, la lista completa con fin de lista y las compuertas desmarcadas»: `text('send-view')` incluye el `warning`, `'Fila 2 → alpha@example.test: a.pdf'`, `'fin de la lista (3)'`; `text('send-gate-status') === 'Falta: marcar las 2 casillas'` cuando hay consentimiento, `'Falta: marcar la casilla de filtros'` sin consentimiento; vacío cuando `execute-send` se habilita.
- «AC-58 / D-53: el vencimiento se muestra como hora fija y al vencer el chip dice Vencida y el toggle se rehabilita».
- «AC-58 / P0-2 / AC-54 (regresión): las casillas nacen desmarcadas en cada confirmación nueva y el botón conserva el texto Enviar N correos».
- «AC-58: la confirmación de prueba muestra Para: con la cuenta y su compuerta de consentimiento cuando corresponde».
- «AC-58: no existe ningún botón de envío fuera de la sección del paso»: como el DOM falso solo ve elementos con `id` (la cabecera no tiene uno y `childrenOf` no sirve para recorrerla), es un test estático sobre `src/Sidebar.html`: exactamente una aparición de `.executeSendPending(` y una de `.executeTestSend(`, cada una dentro de `execute(kind)`; los únicos `<button` del marcado cuyo texto empieza con `Enviar` son `execute-test` y `execute-send`; en el texto del archivo, `id="execute-send"` aparece entre `id="step-4-body"` y `id="progress-section"`, y `id="execute-test"` entre `id="step-3-body"` y `id="section-send"`.

### Consola (AC-59, D-55, D-60)

- «AC-59 / D-55: la tabla conserva tbody con filas de cuatro celdas y asigna la clase de estado por lista cerrada»: `tableRows('results-body')` igual que hoy; `childrenOf('results-body')[0].className === 'row row--sent'`; un `result` desconocido → `'row row--neutral'`.
- «AC-59: progress-fraction muestra procesadas/total y status-live anuncia solo cuando cambia processed»: dos progresos consecutivos con el mismo `processed` no reescriben `status-live`.
- «AC-59: Para revisar mayor que cero destaca el tile y muestra hint-review; pendientes muestra hint-pending y Revisar envío».
- «AC-59 / D-45 (regresión): la falla de transporte deja fase incierta, la guía exacta en progress-guidance con role alert y hint-uncertain».
- «AC-59 / D-45 (regresión): lock no disponible vuelve al paso 4 con el motivo y sin consola»: además de lo actual, `isVisible('send-message') === true`, `isVisible('step-4-body') === true` y `focusedId() === 'step-4-toggle'` aunque la fase nueva sea `configurada`.
- «AC-56 / D-57: cancelar o vencer una confirmación deja abierto el paso de origen con su mensaje»: tras `cancel-send` o `runNextTimer()` del vencimiento, `isVisible('send-message') === true` y la fase es la previa a la confirmación (`terminada` si había `lastResult`).
- «AC-57: revalidar no desprende los elementos estáticos del radar»: dos validaciones seguidas con filas y conteos distintos; después de la segunda, `text('validation-result')` incluye las filas y el valor de `tile-valid-value` de la segunda vista y no las filas de la primera (un nodo desprendido por `clear()` deja de aportar texto a su ex contenedor; `isVisible` no sirve para esto porque un nodo desprendido no tiene ancestros ocultos).
- «AC-59: al terminar se abre la consola con foco en su título».

### Contextual Intelligence (AC-60)

- «AC-60 / D-58: primera apertura sin configuración muestra hint-welcome; con configuración no»; «AC-60: sin borradores muestra hint-no-drafts»; «AC-60: cada ayuda aparece solo con su condición»: tabla fase/datos → ids visibles exactos (deepEqual de la lista de `hint-*` visibles).
- «AC-60: las ayudas no comparan textos del servidor»: un `reason` o `detail` arbitrario no cambia qué ayudas se muestran.

### Accesibilidad (AC-61, AC-62)

- «AC-61 / D-50: aria-expanded y aria-current se actualizan y el foco sigue al paso abierto».
- «AC-61 / D-60: los mensajes conservan role status y la guía y el motivo de corte tienen role alert».
- «AC-62 / D-51: los tokens de color cumplen WCAG AA»: el test extrae `--token: #hex` del `<style>` de `src/Sidebar.html` con una expresión regular, calcula la luminancia relativa y el ratio (fórmula WCAG 2.x) y exige ≥ 4.5 para los pares de texto y ≥ 3 para `--accent` como indicador, listados en "Detalle del código".

### Estáticos (`tests/ui.test.js`, AC-63)

- «AC-63 / D-53: src/Sidebar.html no usa setInterval, requestAnimationFrame ni más de un setTimeout encadenado nuevo»: `setInterval`, `requestAnimationFrame` ausentes; el número de apariciones de `setTimeout(` es exactamente 2 (vencimiento y sondeo).
- «AC-63 / D-54: src/Sidebar.html no carga recursos externos ni define svg con id»: sin `<link`, `@import`, `url(http`, `url("http`, `src=` fuera del único `<script>`; ninguna coincidencia de `<svg[^>]*\sid=`; `color-scheme: dark` presente en el `:root` del `<style>` y ninguna etiqueta `<meta name="color-scheme"` (HtmlService la ignora); `[hidden] { display: none !important; }` presente; `prefers-reduced-motion` presente.
- «AC-32 (regresión): sin innerHTML, alert, confirm ni prompt» (ya existe).

### Vista previa (AC-64, manual)

- `node --check tools/preview-sidebar.js`; `node tools/preview-sidebar.js` genera `tmp/sidebar-preview.html`; abrir en Chrome/Edge con DevTools a 300 px de ancho y recorrer los 13 estados; checklist visual en `docs/OPERATIONS.md` (sin desplazamiento horizontal, foco visible, chips legibles, lista de 500 filas con el fixture `lista-500`). Se registra como ejecutada solo si la persona la ejecuta; el plan no la declara hecha. La checklist de `docs/OPERATIONS.md` dice explícitamente que la vista previa valida el aspecto en un navegador pero no lo que HtmlService ignora o reescribe (por ejemplo, las etiquetas `<meta>`), y que no reemplaza los ítems 22 a 26 en vivo.

## Criterios de aceptación verificables

| ID | Criterio |
|---|---|
| AC-56 | Command Center: la fase se deriva del estado (D-56), el acordeón abre el paso de la fase con foco, resume los pasos cerrados, marca el primario, nunca colapsa un paso con confirmación viva ni la consola en ejecución, y no altera el `disabled` que calcula `refreshControls()`. |
| AC-57 | Preflight Radar: tiles, barra segmentada y grupos reflejan exactamente `ValidationView`; cuota desconocida o insuficiente y "todo excluido" tienen ayuda; la validación sigue sin crear `<input>` y conserva sus textos. |
| AC-58 | Safe Send Review: aviso literal, resumen, lista completa con fin de lista, compuertas desmarcadas en cada confirmación nueva, estado de compuerta en texto, botón `Enviar N correos` único y dentro del paso, vencimiento como hora fija. |
| AC-59 | Live Execution Console: tabla con cuatro celdas por fila y clase por lista cerrada, fracción `processed/total`, anuncio solo al cambiar `processed`, `Para revisar` destacado con pasos de conciliación, pendientes con ayuda, falla de transporte y rechazo como hoy. |
| AC-60 | Contextual Intelligence: cada ayuda `hint-*` aparece solo con su condición de datos reales; ninguna depende de comparar textos del servidor; primera apertura con bienvenida. |
| AC-61 | Accesibilidad dinámica: `aria-expanded`, `aria-current`, foco gestionado, `role="status"` / `role="alert"` según D-60, `label for` en todos los controles, `:focus-visible` definido. |
| AC-62 | Contraste: todos los pares de tokens de texto ≥ 4.5:1 y los indicadores ≥ 3:1, verificado por test sobre el CSS real. |
| AC-63 | Higiene estática: un solo `<script>`, sin recursos externos, sin `svg` con `id`, sin `setInterval`/`requestAnimationFrame`, exactamente dos `setTimeout(`, `color-scheme` oscuro, `[hidden]` con `!important`, `prefers-reduced-motion`. |
| AC-64 | Validación visual local: `tools/preview-sidebar.js` genera una vista previa con los 13 estados a partir de fixtures ficticios, sin tocar `src/`; la checklist visual está en `docs/OPERATIONS.md`. Su ejecución se registra solo cuando ocurre. |

Además: `node --test` completo en verde con los 322 tests existentes intactos (el del helper ampliado) más los nuevos; `node --check` sobre `tools/preview-sidebar.js`, `tests/helpers/fake-dom.js`, `tests/sidebar.test.js`, `tests/sidebar-console.test.js`, `tests/fixtures/sidebar-views.js`, `tests/ui.test.js`; `git diff --check` sin salida; `git remote -v` vacío; `git diff --exit-code 0a0a028 -- src/appsscript.json src/*.js` sin salida (ningún `.js` de producto cambia).

## Orden incremental

Cada fase deja `node --test` en verde y termina en un commit local (Conventional Commits en español, stage por nombre de archivo, `git diff --cached` revisado, nunca `--no-verify`). `src/Sidebar.html` tiene un único responsable de integración: las fases 1 a 6 lo modifican en secuencia, nunca en paralelo.

1. **Fase 0 — DOM falso (D-50).** `tests/helpers/fake-dom.js`, `tests/sidebar.test.js` (solo el test del helper). Tests primero. Commit: `test(sidebar): ampliar el DOM falso con atributos ARIA y gestión del foco`.
2. **Fase 1 — Fundaciones visuales (D-51, D-53, D-54).** `src/Sidebar.html` (CSS, cabecera con identidad, `color-scheme`, marcado envuelto en `.step`/`.console` con los ids nuevos del acordeón pero **sin lógica nueva**: todos los cuerpos visibles, toggles sin manejador), `tests/ui.test.js` (AC-63), `tests/sidebar-console.test.js` (AC-62). Los 32 tests existentes pasan sin cambios. Commit: `feat(sidebar): fundaciones visuales de Eclipse Console`.
3. **Fase 2 — Command Center (D-56, D-57).** `src/Sidebar.html` (`derivePhase`, `openStep`, `renderRail`, `renderPhase`, `status-live`, `skip-test`), `tests/fixtures/sidebar-views.js`, `tests/sidebar-console.test.js` (AC-56, AC-61 parcial). Commit: `feat(sidebar): centro de mando con fases, acordeón y riel de etapa`.
4. **Fase 3 — Preflight Radar.** `src/Sidebar.html` (tiles, meter, grupos, diff de columnas, mensaje con conteos), tests AC-57. Commit: `feat(sidebar): radar de validación con indicadores y grupos`.
5. **Fase 4 — Safe Send Review.** `src/Sidebar.html` (tarjeta de aviso, resumen, chips, fin de lista, `fieldset` de verificación, `gateStatus`, vencimiento como hora), tests AC-58. Commit: `feat(sidebar): revisión segura con compuertas de consentimiento`.
6. **Fase 5 — Live Execution Console (D-55, D-60).** `src/Sidebar.html` (tiles de contadores, fracción, tabla apilada, clases de fila, foco en la consola, `role="alert"`), tests AC-59. Commit: `feat(sidebar): consola de ejecución con registro por fila y conciliación`.
7. **Fase 6 — Contextual Intelligence (D-58).** `src/Sidebar.html` (`hintsFor`, ayudas, estados vacíos, bienvenida), tests AC-60 y AC-61 restante. Commit: `feat(sidebar): ayudas contextuales y estados vacíos`.
8. **Fase 7 — Vista previa y documentación (D-52, D-59).** `tools/preview-sidebar.js`, `README.md`, `docs/OPERATIONS.md`, `docs/ACCEPTANCE_STATUS.md`, `docs/DECISIONS.md`, `docs/PRODUCT.md`, `AGENTS.md`, `plans/2026-11-09_mail-merge-v2.md`. Dos commits: `chore(tools): vista previa local de la sidebar con estados ficticios` y `docs: documentar Eclipse Console, instalación como script vinculado y criterios AC-56 a AC-64`.
9. **Fase 8 — Revisión independiente y cierre.** Subagente de solo lectura "Visual & Accessibility Reviewer" con la checklist de 20 puntos de la auditoría (contraste, foco, `aria-live`, reduced-motion, 300 px, literales, invariantes); sus hallazgos se corrigen por `small-change`, que solo lanza el usuario: se le propone el comando exacto `/spec-driven-dev:small-change` (commits `fix(sidebar): …`). Verificación final completa y cierre de `docs/ACCEPTANCE_STATUS.md` con los resultados reales. Sin commit propio si no hay cambios.

## Verificación

Desde la raíz, Git Bash: `export PATH="/ruta/a/node:$PATH"`.

- `node --test` (todo en verde; informar el conteo real).
- `node --check tests/helpers/fake-dom.js tests/sidebar.test.js tests/sidebar-console.test.js tests/fixtures/sidebar-views.js tests/ui.test.js tools/preview-sidebar.js` (el script de la sidebar se verifica al ejecutarse en los tests).
- `git diff --exit-code 0a0a028 -- src/appsscript.json src/Attachments.js src/Config.js src/Confirmation.js src/Preflight.js src/Send.js src/Services.js src/Setup.js src/Sheet.js src/Template.js src/Ui.js` (sin salida).
- `grep -nE "innerHTML|setInterval|requestAnimationFrame|<link|@import|url\(\"?http" src/Sidebar.html` (sin salida); `grep -c "setTimeout(" src/Sidebar.html` = 2.
- `git diff --check`, `git status --short`, `git remote -v` (vacío), `git ls-files | grep -iE "clasp|credential|token|\.pem|\.key"` (vacío).
- Vista previa: `node tools/preview-sidebar.js && ls tmp/sidebar-preview.html`; apertura manual en el navegador a 300 px, recorriendo los 13 estados con la checklist de `docs/OPERATIONS.md`. Resultado: `LOCAL_VERIFIED` solo para lo que se ejecutó; las capturas se agregan a `docs/screenshots/` cuando existan.

## Pendiente de validación en vivo (`PENDING LIVE VALIDATION`)

Se agregan a la checklist de `docs/OPERATIONS.md` (numeración continua desde el 22):

22. Render real en el iframe de HtmlService de `<style>` con custom properties, SVG inline, `mask-image` con `data:` URI, `color-scheme`, `:focus-visible` y `prefers-reduced-motion`.
23. Aspecto del panel oscuro junto a una hoja clara de Sheets y legibilidad de los controles nativos (`select`, `input`, `progress`, casillas) con `color-scheme: dark`.
24. Comportamiento del acordeón, del foco y de los anuncios `role="status"` / `role="alert"` con lectores de pantalla dentro de Sheets.
25. Rendimiento y desplazamiento con 500 filas en la confirmación con el nuevo marcado (amplía el ítem 17).
26. Tamaño del HTML servido por `createHtmlOutputFromFile` con el CSS e iconos nuevos (no hay límite publicado).

Los ítems 13 (`getSendProgress` en paralelo), 17 (500 filas) y 20 (`setTimeout` en el iframe) siguen vigentes.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Romper el DOM falso o relajar sus barreras | D-50 con lista blanca cerrada; fase 0 aislada y probada; el test del helper verifica que `innerHTML`, selectores, `createElementNS`, `setAttribute('href')` y eventos no listados sigan lanzando |
| Cambiar sin querer un id, un literal o la estructura que un test o la documentación fijan | Lista explícita en "Invariantes"; la fase 1 debe pasar los 32 tests sin tocarlos; inventario de literales citados en la auditoría; AC-63 |
| Duplicar el punto de entrada al envío (barra fija, atajo) | Descartado en "Alternativas"; AC-58 verifica un único botón de envío dentro del paso |
| Timers nuevos por microinteracciones o cuenta regresiva | D-53; AC-63 cuenta exactamente dos `setTimeout(`; tests de `pendingTimers()` existentes |
| Métricas inventadas | Invariante explícito; `<progress max=total value=processed>`; `progress-fraction` solo con esos dos números |
| Tema oscuro fijo frente a la hoja clara | D-51 aprobada; ítem 23 en vivo; variante clara diferida |
| HtmlService y CSS moderno | Ítems 22 a 26 en vivo; la vista previa local (D-59) valida el render en un navegador real sin Google |
| 500 filas con marcado más alto | Una línea por fila, sin tarjetas por fila en la confirmación; fixture `lista-500` en la vista previa; ítem 25 |
| Deriva de documentación | Fase 7 actualiza README, OPERATIONS, ACCEPTANCE_STATUS, DECISIONS, PRODUCT, AGENTS y el plan V2 en el mismo commit |
| Conflictos de edición en `Sidebar.html` | Un único responsable de integración; fases secuenciales |

## Estrategia de integración con Sheets y preparación para GitHub

- **Menú y apertura:** sin cambios en `src/Ui.js` (D-25, D-52): `Mail Merge → Abrir Mail Merge` abre `Sidebar` con título `Mail Merge`. La cabecera del panel muestra `Mail Merge ZB` y `Eclipse Console`.
- **Primera apertura:** fase `sin-configurar` con `hint-welcome` (cuatro pasos, nada se envía sin confirmación) y, si no hay borradores, `hint-no-drafts`.
- **Instalación reproducible (README, sección "Instalación"):** (a) abrir la hoja de prueba, `Extensiones → Apps Script`, crear un archivo por cada `src/*.js` y `src/Sidebar.html` con el mismo nombre, reemplazar el manifest (`appsscript.json`), guardar, recargar la hoja; (b) alternativa con `clasp` descripta y nunca ejecutada por este proyecto: `clasp login`, `clasp create-script --parentId <id de la hoja de prueba> --rootDir src` (clasp 3.x; `--parentId` vincula el script a la hoja existente, mientras que `--type sheets` crearía una hoja nueva; los nombres anteriores `create` y `clone` se documentan como alias, a confirmar contra la documentación vigente al usarlos) o `clasp clone-script <scriptId> --rootDir src`, y `clasp push`, con la advertencia de que `.clasp.json` y `.clasprc.json` están ignorados por Git; (c) pantalla de consentimiento y scopes amplios (D-24) con autorización explícita previa; (d) aclaración de que es un **script vinculado**, no un complemento de Marketplace, y de que cada usuario autoriza su propia copia.
- **Capturas y documentación para GitHub:** `tools/preview-sidebar.js` permite capturar los 13 estados en un navegador; las imágenes van en `docs/screenshots/<estado>.png` y se referencian desde el README solo cuando existen. El README también incluye: qué hace, estados de `Resultado`, límites, verificación local, estructura, licencia (a definir por el usuario; el plan no la elige) y el estado `LOCAL_VERIFIED` / `PENDING LIVE VALIDATION`.
- **Higiene para la publicación:** `git ls-files` sin secretos; datos ficticios en tests y vista previa; sin remotos hasta que el usuario lo autorice.

## Hechos externos a verificar en due diligence

- Que el sandbox IFRAME de HtmlService no reescriba ni bloquee `<svg>` inline, `mask-image` con `data:` URI, `<meta name="color-scheme">` ni `:focus-visible` (documentación pública de HtmlService).
- Que `google.script.host.close()` y `setTimeout` sigan disponibles (ya `PENDING LIVE VALIDATION`, ítem 20).
- Fórmula de luminancia relativa y de ratio de contraste de WCAG 2.x usada por AC-62 (umbrales 4.5:1 y 3:1).
- Que `prefers-reduced-motion` se respete dentro de un iframe (estándar web; media query del documento anidado).

## Due diligence record

Registro de lo que concluyó la verificación de hechos externos (due diligence del 2026-11-14), para que lo lean las pasadas posteriores, incluido el fact check de la implementación. Ninguna pasada puede tomar una línea de esta sección como motivo para saltear una verificación: el registro dice qué se concluyó una vez, no qué es cierto ahora. Si una persona edita a mano el hecho correspondiente, debe **borrar** la línea en lugar de actualizarla, para que la sección no afirme cosas que nadie verificó.

- SETTLED: `:root { color-scheme: dark; }` en el CSS, en lugar de `<meta name="color-scheme" content="dark">` (corregido: la referencia de `HtmlOutput.addMetaTag` dice que las `<meta>` escritas en el archivo HTML se ignoran y solo admite `viewport`, `apple-mobile-web-app-capable`, `mobile-web-app-capable` y `google-site-verification`; MDN `color-scheme`: la propiedad en `:root` cambia los colores por defecto de controles de formulario y barras de desplazamiento, Baseline desde enero de 2022)
- SETTLED: todo HtmlService corre en modo `IFRAME`; `setSandboxMode` ya no tiene efecto (verificado contra developers.google.com/apps-script/reference/html/html-output y guides/html/restrictions)
- SETTLED: `<base target="_top">` es la forma documentada de fijar el destino de los enlaces en el iframe (verificado contra guides/html/restrictions)
- SETTLED: `google.script.host.close()` cierra el diálogo o la barra lateral actual (verificado contra developers.google.com/apps-script/guides/html/reference/host)
- SETTLED: luminancia relativa `L = 0.2126 * R + 0.7152 * G + 0.0722 * B`, linealización con umbral `0.04045` (`c / 12.92`, si no `((c + 0.055) / 1.055) ^ 2.4`), ratio `(L1 + 0.05) / (L2 + 0.05)`, sin redondear (verificado contra W3C Understanding WCAG 2.2, SC 1.4.3)
- SETTLED: umbrales `4.5:1` para texto (SC 1.4.3) y `3:1` para componentes e indicadores no textuales (SC 1.4.11) (verificado contra W3C WCAG 2.2)
- SETTLED: los diez pares de tokens de AC-62 superan el umbral con la fórmula anterior (mínimo `--muted`/`--surface-2` = 5.97:1; `--accent`/`--surface` = 6.65:1); `#6B7280` sobre `--surface` da 3.49:1 (cálculo local con la fórmula verificada)
- SETTLED: `:focus-visible` (Baseline desde marzo de 2022), `mask-image` sin prefijo (Baseline desde diciembre de 2023) y `prefers-reduced-motion` (Baseline desde enero de 2020) en navegadores actuales (verificado contra MDN)
- OPEN (unverified): que el iframe de HtmlService sirva sin reescribir ni bloquear `<svg>` inline, `mask-image` con `data:` URI, custom properties y `:focus-visible`; la documentación de restricciones no menciona SVG, CSS en línea ni CSP para `data:`. Queda en el ítem 22 en vivo
- OPEN (unverified): que `prefers-reduced-motion` se evalúe igual dentro del iframe anidado de Sheets; MDN y la documentación de Apps Script no tratan los contextos anidados. Queda en el ítem 22 en vivo
- OPEN (unverified): `setTimeout` dentro del iframe de HtmlService; no está documentado para el sandbox (los flags documentados incluyen `allow-scripts`). Sigue en el ítem 20 en vivo
- OPEN (currency): `clasp create --type sheets --rootDir src` / `clasp clone` / `clasp push` / `clasp login` de la sección de instalación; clasp 3.x documenta `create-script` y `clone-script` y dice que los comandos renombrados conservan alias, sin confirmar `create`/`clone`; además `--type sheets` crea un contenedor nuevo y el enlace a una hoja existente es `--parentId <id>`

## Implementation steps

Convenciones comunes a todos los pasos:

- **Decisiones:** D-49 a D-60 están aprobadas y no se cambian en ningún paso. Mapa de decisiones por paso: D-50 → paso 1; D-51, D-53, D-54 → paso 2; D-56, D-57 → paso 3; D-58 → pasos 4 a 7 (cada uno agrega sus ayudas); D-55, D-60 → paso 6; D-52, D-59 → pasos 8 y 9; D-49 → paso 9 (registro en `docs/DECISIONS.md`).
- Node portable en el PATH solo del proceso (Git Bash): `export PATH="/ruta/a/node:$PATH"`. Todos los comandos se ejecutan desde la raíz del proyecto. Sin `npm install`, sin `package.json`, sin `clasp`, sin OAuth, sin envíos ni acceso a Google, sin remotos.
- **Único responsable de `src/Sidebar.html`:** los pasos 2 a 7 lo modifican en secuencia, cada uno sobre el resultado commiteado del anterior; nunca se ejecutan dos de esos pasos en paralelo ni otro paso toca ese archivo. Los pasos 1, 8, 9 y 10 no lo modifican (los hallazgos del paso 10 van por `small-change`, también en secuencia).
- Prohibido en todos los pasos: modificar `src/*.js` o `src/appsscript.json`; renombrar, relajar o reescribir cualquiera de los 32 tests de `tests/sidebar.test.js` (solo el paso 1 amplía el test del helper) o los tests existentes de `tests/ui.test.js`; cambiar ids, literales o estructura listados en "Invariantes que se preservan"; agregar temporizadores (siempre exactamente dos `setTimeout(` en `src/Sidebar.html`), `innerHTML`, selectores, `createElementNS`, `classList`, `dataset`, `style` o recursos externos.
- Tests primero en cada paso. Los tests nuevos de interfaz van en `tests/sidebar-console.test.js` (CommonJS, `node:test` y `node:assert/strict`, `loadSidebar` de `tests/helpers/fake-dom.js`); desde el paso 3 usan los fixtures de `tests/fixtures/sidebar-views.js`. Los títulos llevan el ID que cubren (`AC-xx`, `D-xx`) tal como figuran en "Escenarios de prueba". Solo datos ficticios (`example.test`).
- **Ayudas incrementales (refinamiento del orden, sin cambiar D-58):** el paso 3 crea `hintsFor(phase, data)` y `renderHints()` con la lista cerrada de ids `hint-*` vacía; cada paso posterior agrega el marcado estático de sus ayudas y su condición exacta de la tabla "`hintsFor(phase, data)`": paso 4 las del radar, paso 5 las de la revisión, paso 6 las de la consola, paso 7 el resto y el test de tabla completa de AC-60. Motivo: "Escenarios de prueba" ubica tests de ayudas en Radar y Consola. `progress-truncated` lo sigue alternando `renderProgress`, no `hintsFor`.
- Cada paso deja `node --test` completo en verde (baseline 322 tests; informar el recuento real) y `git diff --exit-code 0a0a028 -- src/appsscript.json src/Attachments.js src/Config.js src/Confirmation.js src/Preflight.js src/Send.js src/Services.js src/Setup.js src/Sheet.js src/Template.js src/Ui.js` sin salida.
- Un commit local por paso (lo hace quien orquesta la implementación; el implementador no commitea): Conventional Commits en español, stage por nombre de archivo, `git diff --cached` revisado, nunca `--no-verify`. Cada paso sugiere el mensaje de "Orden incremental".
- Estos pasos siguen las fases 0 a 8 de "Orden incremental" (paso N = fase N-1, salvo la fase 7); la única división es la fase 7, que se separa en los pasos 8 (vista previa) y 9 (documentación) porque juntas suman ocho archivos de naturaleza distinta y ya preveían dos commits.

### Step 1: DOM falso con atributos ARIA y gestión del foco (fase 0, D-50)

- **Files**: modificar `tests/sidebar.test.js` (solo el test `fake-dom: document y los elementos lanzan fuera del subconjunto permitido`) y `tests/helpers/fake-dom.js`.
- **Do**:
  1. Tests primero: ampliar el test del helper según "Escenarios de prueba > Helper" sin tocar sus aserciones actuales ni ningún otro test.
  2. `tests/helpers/fake-dom.js` según "DOM falso (D-50): API resultante" y "Detalle del código > `tests/helpers/fake-dom.js`": `ATTRIBUTE_NAME = /^(aria-[a-z]+|role)$/`; `node.attributes = {}` en `makeElement` para todo nodo (marcado, `createElement`, `new Option`); `setAttribute` lanza `Sidebar: atributo no permitido "<name>"` fuera de la lista y guarda `String(value)`; `getAttribute` devuelve el texto o `null`; `removeAttribute` borra; `focus()` registra `node.id` en la variable `focused` de `loadSidebar()`; `blur()` la vacía si coincide.
  3. Sumar `setAttribute`, `getAttribute`, `removeAttribute`, `focus` y `blur` a `ELEMENT_READ` **y** al `case` del `get` del `Proxy` que devuelve `api[prop]` (junto a `appendChild`, `removeChild`, `addEventListener`, `add`).
  4. El parser copia a `node.attributes` los `aria-*` y `role` estáticos de cada elemento con `id` con la expresión global `\s(aria-[a-z]+|role)\s*=\s*"([^"]*)"` sobre `attrs` (sin colisión con la lectura de `id`, que exige `\sid=`).
  5. El objeto devuelto por `loadSidebar()` suma `focusedId()` y `attribute(id, name)`. Actualizar el comentario de cabecera del helper (subconjunto ampliado por D-50; `classList`, `dataset`, `style`, `querySelector*`, `createElementNS`, `cloneNode`, `innerHTML`, eventos `input`/`keydown`/`submit` y temporizadores siguen sin existir).
- **Test**: en el test ampliado, `setAttribute('href'|'onclick'|'style'|'data-x', …)` lanza; `classList`, `dataset`, `createElementNS` y `addEventListener('input', …)` lanzan; `setAttribute('aria-expanded', 'true')` y luego `getAttribute('aria-expanded') === 'true'`; `removeAttribute` → `getAttribute` devuelve `null`; `focus()` sobre un elemento con id → `focusedId()` igual a ese id y `blur()` lo vacía; un `role` estático del marcado actual (por ejemplo `role="status"` de `config-message`) se lee con `attribute(id, 'role')`. Regresión: los otros 31 tests de `tests/sidebar.test.js` pasan sin cambios.
- **Verify**: `node --test` (todo pasa, mismo recuento que la baseline); `node --check tests/helpers/fake-dom.js tests/sidebar.test.js`; `git diff --check` sin salida; `git diff --stat` solo muestra los dos archivos. Commit sugerido: `test(sidebar): ampliar el DOM falso con atributos ARIA y gestión del foco`.

### Step 2: Fundaciones visuales de Eclipse Console (fase 1, D-51, D-53, D-54)

- **Files**: crear `tests/sidebar-console.test.js`; modificar `tests/ui.test.js` (solo tests nuevos) y `src/Sidebar.html`.
- **Do**:
  1. Tests primero (ver **Test**).
  2. `src/Sidebar.html`, CSS: tokens y extracto normativo de "Detalle del código > CSS" (valores hex exactos, `color-scheme: dark` en `:root`, `[hidden] { display: none !important; }`, `:focus-visible`, primitivas `.btn` / `.btn--primary` / `.btn--ghost` / `.btn--send` / `.card` / `.chip` / `.tile` / `.meter` / `.gate` / `.step` / `.rail` / `.hint` / `.ic`, tabla `.log` apilada, `.sr-only`, clases de ancho `w-0` … `w-10` y de fila `row--*`, `@media (prefers-reduced-motion: no-preference)` para transiciones y `@media (prefers-reduced-motion: reduce)` que las anula); sin `<meta name="color-scheme">`, `<link>`, `@import`, `url(http` ni fuentes web.
  3. Marcado según "Arquitectura de presentación": cabecera `<header class="brand">` con logo SVG estático (D-54), `Mail Merge ZB`, `Eclipse Console`, el botón `close` (texto `Cerrar`) movido a la cabecera y el riel `rail` con `rail-1`..`rail-4`; cada sección existente como `.step` conservando `section-campaign`, `section-validation`, `section-test`, `section-send`, y la consola `progress-section`; en cada paso, `<button type="button" id="step-N-toggle" aria-expanded="true" aria-controls="step-N-body">` con número, el título literal (`Campaña`, `Validación`, `Prueba`, `Envío`), `<span id="step-N-summary">` y `<span id="step-N-chip">`, y el contenido actual dentro de `<div id="step-N-body">`; consola con `<h2 id="console-title" tabindex="-1">Progreso y resultados</h2>`.
  4. **Sin lógica nueva:** todos los cuerpos visibles, toggles sin manejador, script sin cambios de comportamiento. Todos los ids de "Invariantes" con el mismo elemento y semántica; ningún `<svg>` con `id` ni dentro de un elemento cuyo `textContent` escriba el script; `type="button"` en todos los botones; ningún `>` dentro de valores de atributos.
- **Test**:
  - `tests/ui.test.js` (AC-63), dos tests nuevos con los títulos de "Escenarios de prueba > Estáticos": «AC-63 / D-53: …» (`setInterval` y `requestAnimationFrame` ausentes; exactamente 2 apariciones de `setTimeout(`) y «AC-63 / D-54: …» (un solo `<script>`; sin `<link`, `@import`, `url(http`, `url("http`, `src=` fuera de ese `<script>`; ninguna coincidencia de `<svg[^>]*\sid=`; `color-scheme: dark` dentro del `:root` del `<style>`; sin `<meta name="color-scheme"`; `[hidden] { display: none !important; }`; `prefers-reduced-motion` presente).
  - `tests/sidebar-console.test.js` (AC-62): «AC-62 / D-51: los tokens de color cumplen WCAG AA»: extrae `--token: #hex` del `<style>` real con una expresión regular, calcula luminancia relativa y ratio con la fórmula del "Due diligence record" (sin redondear) y exige ≥ 4.5 para `--text`/`--bg`, `--text`/`--surface`, `--text`/`--surface-2`, `--muted`/`--bg`, `--muted`/`--surface`, `--muted`/`--surface-2`, `--warn`/`--surface`, `--danger`/`--surface`, `--accent-ink`/`--accent`, y ≥ 3 para `--accent`/`--surface`.
  - Un test de estructura en `tests/sidebar-console.test.js`: los ids nuevos (`step-1-toggle`..`step-4-toggle`, `step-N-body`, `step-N-summary`, `step-N-chip`, `rail-1`..`rail-4`, `console-title`) existen, `aria-controls` de cada toggle apunta a su cuerpo, y la carga sigue sin crear elementos ni temporizadores.
  - Regresión: los 32 tests de `tests/sidebar.test.js` y los de `tests/ui.test.js` pasan sin cambios.
- **Verify**: `node --test` (todo pasa; informar recuento); `node --check tests/sidebar-console.test.js tests/ui.test.js`; `grep -nE "innerHTML|setInterval|requestAnimationFrame|<link|@import|url\(\"?http" src/Sidebar.html` sin salida; `grep -c "setTimeout(" src/Sidebar.html` = 2; `git diff --check` sin salida; `git diff --exit-code 0a0a028 -- src/appsscript.json src/*.js` sin salida. Commit sugerido: `feat(sidebar): fundaciones visuales de Eclipse Console`.

### Step 3: Command Center con fases, acordeón y riel (fase 2, D-56, D-57)

- **Files**: crear `tests/fixtures/sidebar-views.js`; modificar `tests/sidebar-console.test.js` y `src/Sidebar.html`.
- **Do**:
  1. `tests/fixtures/sidebar-views.js` (CommonJS) según "Vista previa local (D-59)": exporta `panelState(overrides)` (variantes `current: null` y `drafts: []`), `validationView(variant)`, `confirmationView(kind, variant)`, `progress(variant)`, `sendResult(variant)` con los mismos datos que construye hoy `tests/sidebar.test.js` (que no se refactoriza). Variantes nombradas por texto (`'ok'`, `'setup'`, `'setup-bloqueado'`, `'bloqueada'`, `'consentimiento'`, …); los pasos siguientes pueden agregar otras sin cambiar las existentes.
  2. Tests primero (ver **Test**).
  3. `src/Sidebar.html`, estado: ampliar `state` con `panel`, `configSaved`, `lastValidation`, `lastResult`, `transportFailed`, `openStep` según "Estado del cliente (ampliación)" y su párrafo de reglas (`panel` en `onPanelState`, `null` si falla; `configSaved` por `panel.current !== null` o `saveConfig` exitoso; `lastValidation` y `lastResult` a `null` al guardar configuración; `lastResult = null` y `transportFailed = false` en `startRun()`, en el mismo punto donde hoy se oculta la guía; `lastResult` en `onRunFinished` con `result.ok`; `transportFailed = true` en `onRunFailed`; `lastValidation` en `renderValidation`; `change` → `refreshControls` en `sheet`, `draft` y `from`).
  4. Utilidades `setClass`, `setAria`, `focusNode` de "`src/Sidebar.html`: utilidades nuevas" (`formatTime` y `rowStatusClass` llegan en los pasos 5 y 6).
  5. `derivePhase(state)` con la tabla de condiciones en orden exacto; `MailMergePanel.phase()` la expone. `openStep(n, moveFocus)`, `renderRail(phase)` (clases `rail__dot` + `is-done` / `is-current` / `is-locked`, `aria-current="step"` en el actual, chips y resúmenes con los textos de "Acordeón y riel") y `renderPhase()` al final de `refreshControls()`: asigna `disabled` de `step-3-toggle` / `step-4-toggle` según confirmación viva **antes** de `openStep`, aplica el mapa fase → paso abierto / botón primario (`btn btn--primary`, `btn`, `btn btn--ghost`), escribe el anuncio en el nuevo `<p id="status-live" role="status" aria-live="polite" class="sr-only">`, abre el paso por defecto con foco solo cuando la fase cambia y respeta la "Regla de apertura automática" (sin apertura al salir de `revisando-*` / `enviando` hacia una fase que no sea `terminada` ni `incierta`; `openStep(run.kind === 'test' ? 3 : 4, true)` explícito en `onRunFinished` con `!result.ok`, después de `refreshControls()`). Ningún `disabled` de botón de acción cambia respecto de las reglas actuales de `refreshControls()`.
  6. Toggles: `click` → `openStep(i, false)` salvo `disabled`; botón `<button type="button" id="skip-test">Ir a Envío</button>` en el paso 3, visible en la fase `lista`, que solo llama a `openStep(4, true)` sin llamadas al servidor.
  7. `hintsFor(phase, data)` y `renderHints()` con la lista de ids vacía (ver convenciones), llamados desde `renderPhase()`.
- **Test** (`tests/sidebar-console.test.js`, títulos de "Escenarios de prueba > Fases y Command Center"):
  - «AC-56 / D-56: al cargar sin configuración la fase es sin-configurar, el paso 1 está abierto y Guardar es el primario» (paso 2 oculto, `aria-expanded` del toggle 1 en `'true'`, `aria-current` de `rail-1` en `'step'`, `dom.created.length === 0`, sin temporizadores).
  - «AC-56 / D-56: con configuración guardada la fase es configurada y Validar es el primario» (`step-1-summary` con el nombre de campaña del fixture, `step-1-chip === 'Lista'`).
  - «AC-56 / D-57: una validación correcta abre el paso 3 con foco y resume el paso 2» (`focusedId() === 'step-3-toggle'`, resumen del paso 2 según el fixture, `review-test` primario, `skip-test` visible y su clic abre el paso 4 sin llamadas nuevas).
  - «AC-56 / D-57: el toggle de un paso cerrado lo abre y el del paso con confirmación viva está deshabilitado».
  - «AC-56 / D-56: preparar columnas, bloqueada, revisando-envio, enviando, terminada e incierta se derivan del estado» (tabla de casos con fase y chips).
  - «D-56: las fases no cambian disabled de ningún botón respecto de refreshControls» (tabla por fase de los botones de acción existentes; los toggles no entran).
  - «AC-56 / D-57: cancelar o vencer una confirmación deja abierto el paso de origen con su mensaje» (con y sin `lastResult` previo: fase `terminada` o la previa a la confirmación).
  - «AC-61 / D-50: aria-expanded y aria-current se actualizan y el foco sigue al paso abierto» (toggles y riel).
  - Regresión: «AC-52…» de `tests/sidebar.test.js` (una sola llamada `getPanelState`, sin temporizadores ni elementos creados) y los 32 tests existentes sin cambios.
- **Verify**: `node --test` (todo pasa; informar recuento); `node --check tests/fixtures/sidebar-views.js tests/sidebar-console.test.js`; `grep -c "setTimeout(" src/Sidebar.html` = 2; `grep -n "innerHTML" src/Sidebar.html` sin salida; `git diff --check` sin salida; `git diff --exit-code 0a0a028 -- src/appsscript.json src/*.js` sin salida. Commit sugerido: `feat(sidebar): centro de mando con fases, acordeón y riel de etapa`.

### Step 4: Preflight Radar (fase 3, AC-57)

- **Files**: modificar `tests/sidebar-console.test.js`, `tests/fixtures/sidebar-views.js` (variantes de validación que falten: cuota `null`, cuota corta, todo excluido, sobrescritura) y `src/Sidebar.html`.
- **Do**:
  1. Tests primero (ver **Test**).
  2. Marcado estático dentro de `validation-result` según "Radar (paso 2)": tiles `tile-valid`, `tile-invalid`, `tile-excluded`, `tile-quota` con sus `tile-*-value`; meter `meter-valid`, `meter-invalid`, `meter-excluded`; `<div id="validation-lines">`; grupos `group-excluded`, `group-invalid`, `group-rows` con toggles `toggle-excluded` (nace `aria-expanded="false"` y grupo oculto), `toggle-invalid` y `toggle-rows` (nacen `"true"`). `validation-result` deja de vaciarse: `renderValidation` vacía solo `validation-lines` y los tres `group-*`; todo texto que hoy buscan los tests con `text('validation-result')` sigue siendo descendiente suyo, incluida la línea `Cuota diaria restante de Gmail: N`.
  3. `renderValidation(view)`: escribe los tiles (`no disponible` con cuota `null`) y el meter (`className` fijo más `w-0`…`w-10` = `Math.round(10 * n / total)`, `textContent` del conteo, sin `style`); mensaje `'La validación encontró problemas: ' + globalErrors.length + ' globales · ' + counts.invalid + ' filas con errores'` cuando `!view.ok` y `'Validación sin errores globales.'` cuando `view.ok`. Los toggles de grupo alternan `hidden` y `aria-expanded`.
  4. `renderSetup(setup)` como lista diff (`~` renombres, `+` agregados, `!` bloqueos, como texto) conservando `Renombrar "…" → "…" (columna X)`; `apply-setup` sigue llamando a `applyColumnSetup(setup.headerKey)` y revalida.
  5. Ayudas del radar (marcado estático y condición en `hintsFor`): `hint-setup`, `hint-setup-blocked`, `hint-quota-unknown`, `hint-quota-short` con `<span id="hint-quota-short-n">` (condición con `typeof quotaRemaining === 'number'`), `hint-all-excluded`, `hint-overwrite`.
- **Test** (títulos de "Escenarios de prueba > Radar"):
  - «AC-57: los tiles muestran válidas, con errores, excluidas y cuota exactamente como la ValidationView» (incluye `quotaRemaining: null` → `'no disponible'`, `hint-quota-unknown` visible y `hint-quota-short` oculta).
  - «AC-57 / D-58: cuota menor que las filas válidas muestra hint-quota-short con el número»; «AC-57 / D-58: todas las filas excluidas muestra hint-all-excluded».
  - «AC-57: los grupos de exclusiones, errores y filas se pliegan por botón con aria-expanded y sin ocultar nada en la confirmación».
  - «AC-57 / D-35: el plan de columnas se muestra como diff y Preparar columnas sigue llamando a applyColumnSetup con headerKey» (con `hint-setup`; con `setup.errors` → `hint-setup-blocked` y `apply-setup` deshabilitado como hoy).
  - «AC-54 / D-47 (regresión): overwriteRows sigue siendo un aviso sin casilla y la validación no crea inputs» (más `hint-overwrite` visible).
  - «AC-57: el mensaje de validación con problemas informa los conteos».
  - «AC-57: revalidar no desprende los elementos estáticos del radar» (dos validaciones distintas; solo quedan filas y tiles de la segunda).
  - Regresión: los tests de validación de `tests/sidebar.test.js` sin cambios.
- **Verify**: `node --test` (todo pasa; informar recuento); `node --check tests/sidebar-console.test.js tests/fixtures/sidebar-views.js`; `grep -c "setTimeout(" src/Sidebar.html` = 2; `git diff --check` sin salida; `git diff --exit-code 0a0a028 -- src/appsscript.json src/*.js` sin salida. Commit sugerido: `feat(sidebar): radar de validación con indicadores y grupos`.

### Step 5: Safe Send Review con compuertas (fase 4, AC-58)

- **Files**: modificar `tests/sidebar-console.test.js`, `tests/ui.test.js` (un test estático nuevo), `tests/fixtures/sidebar-views.js` (si falta alguna variante de confirmación) y `src/Sidebar.html`.
- **Do**:
  1. Tests primero (ver **Test**).
  2. `renderConfirmation(kind, view)` según "Safe Send Review (pasos 3 y 4)": conserva el contenido textual de `test-view` / `send-view`, agrega tarjeta de aviso con el `warning` literal, resumen y chips de adjuntos (creados con `createElement` + `textContent` dentro de lo que el script vacía; sin elementos estáticos con id adentro), la línea final `'── fin de la lista (' + count + ') ──'` y `Vence a las HH:MM (10 min)` con `formatTime` en lugar de `toLocaleString()`; en la prueba, la línea `Para: <cuenta>` destacada. Sin grupos colapsables en la confirmación.
  3. Casillas `send-filter-ack`, `send-consent`, `test-consent` con sus ids y `label` dentro de `<fieldset class="gate"><legend>Verificación</legend>`; siguen naciendo desmarcadas en cada confirmación nueva y al descartar, cancelar, vencer, terminar o fallar.
  4. `gateStatus(kind)` y los párrafos `send-gate-status` / `test-gate-status` (textos exactos `Falta: marcar las 2 casillas`, `Falta: marcar la casilla de filtros`, `Falta: marcar el consentimiento`, o `''`; `''` sin confirmación viva), actualizados por `refreshControls()` en cada cambio de casilla. `execute-test` / `execute-send` con `className` `btn btn--primary btn--send` (icono solo por CSS `mask-image`, sin `<svg>` dentro) y `textContent` exactamente `Enviar prueba` / `Enviar 1 correo` / `Enviar N correos`. Al vencer: chip `Vencida`, botón deshabilitado, toggle del paso rehabilitado.
  5. Ayudas: `hint-filter-views` (el párrafo de ayuda actual de la sección Envío, con el mismo texto, recibe ese id y se muestra en `revisando-envio`) y `hint-consent` (`consentRequired`).
- **Test** (títulos de "Escenarios de prueba > Safe Send Review"):
  - «AC-58: la confirmación de envío muestra el aviso, el resumen, la lista completa con fin de lista y las compuertas desmarcadas» (los textos de `send-gate-status` según casillas y consentimiento; vacío con `execute-send` habilitado).
  - «AC-58 / D-53: el vencimiento se muestra como hora fija y al vencer el chip dice Vencida y el toggle se rehabilita» (`Vence a las ` + `(10 min)`; tras `runNextTimer()`, `step-4-chip === 'Vencida'`, `step-4-toggle` habilitado, `execute-send` deshabilitado, mensaje con «venció»; un solo temporizador tras preparar).
  - «AC-58 / P0-2 / AC-54 (regresión): las casillas nacen desmarcadas en cada confirmación nueva y el botón conserva el texto Enviar N correos».
  - «AC-58: la confirmación de prueba muestra Para: con la cuenta y su compuerta de consentimiento cuando corresponde».
  - `tests/ui.test.js`: «AC-58: no existe ningún botón de envío fuera de la sección del paso» (estático: una aparición de `.executeSendPending(` y una de `.executeTestSend(` dentro de `execute(kind)`; los únicos `<button` cuyo texto empieza con `Enviar` son `execute-test` y `execute-send`; `id="execute-send"` entre `id="step-4-body"` y `id="progress-section"`; `id="execute-test"` entre `id="step-3-body"` y `id="section-send"`).
  - Ayudas: `hint-filter-views` visible solo en `revisando-envio`; `hint-consent` solo con `consentRequired`.
  - Regresión: tests de confirmación, consentimiento (AC-54, P0-2) y cancelación de `tests/sidebar.test.js` sin cambios.
- **Verify**: `node --test` (todo pasa; informar recuento); `node --check tests/sidebar-console.test.js tests/ui.test.js tests/fixtures/sidebar-views.js`; `grep -c "setTimeout(" src/Sidebar.html` = 2; `git diff --check` sin salida; `git diff --exit-code 0a0a028 -- src/appsscript.json src/*.js` sin salida. Commit sugerido: `feat(sidebar): revisión segura con compuertas de consentimiento`.

### Step 6: Live Execution Console (fase 5, D-55, D-60, AC-59)

- **Files**: modificar `tests/sidebar-console.test.js`, `tests/fixtures/sidebar-views.js` (si faltan variantes de progreso o resultado) y `src/Sidebar.html`.
- **Do**:
  1. Tests primero (ver **Test**).
  2. `setCounters(counts)` según "Consola (progreso y resultados)": conserva los ids `count-*` dentro de tiles con las etiquetas completas, agrega `<span id="progress-fraction">` (`processed + '/' + total`) y `className` `tile tile--warn` en `<div id="tile-review">` cuando `review > 0` (`tile` en otro caso). `<progress>` sigue con `max = total` y `value = processed`; nada derivado.
  3. `renderRows(rows, recipientOf)`: conserva la tabla (`<table class="log">`, `<thead>` con `Fila`, `Destinatario`, `Resultado`, `Detalle`, `<tbody id="results-body">` con `<tr>` de cuatro `<td>`) y asigna a cada `<tr>` `className = rowStatusClass(row.result)` (lista cerrada de D-55, función de "utilidades nuevas").
  4. `renderProgress` escribe `status-live` con `'Enviando: ' + processed + ' de ' + total` solo cuando `processed` cambió respecto del último anuncio. `onRunFinished` conserva sus textos, guarda `state.lastResult` y abre la consola con `openStep(5, true)` (foco en `console-title`); con `!result.ok` mantiene el `openStep` explícito al paso de origen del paso 3.
  5. D-60: `progress-guidance` y `stopped-reason` pasan a `role="alert"` (marcado estático); los `…-message` y `progress-status` conservan `role="status" aria-live="polite"` sin cambios.
  6. Ayudas de la consola: `hint-review` (`terminada` y `counts.review > 0`), `hint-pending` (`terminada` y `counts.pending > 0`; `review-send` secundario visible en el paso 4), `hint-uncertain` (`incierta`).
- **Test** (títulos de "Escenarios de prueba > Consola"):
  - «AC-59 / D-55: la tabla conserva tbody con filas de cuatro celdas y asigna la clase de estado por lista cerrada» (`row row--sent`; resultado desconocido → `row row--neutral`).
  - «AC-59: progress-fraction muestra procesadas/total y status-live anuncia solo cuando cambia processed».
  - «AC-59: Para revisar mayor que cero destaca el tile y muestra hint-review; pendientes muestra hint-pending y Revisar envío».
  - «AC-59 / D-45 (regresión): la falla de transporte deja fase incierta, la guía exacta en progress-guidance con role alert y hint-uncertain».
  - «AC-59 / D-45 (regresión): lock no disponible vuelve al paso 4 con el motivo y sin consola» (`send-message` y `step-4-body` visibles, `focusedId() === 'step-4-toggle'`).
  - «AC-59: al terminar se abre la consola con foco en su título» (`focusedId() === 'console-title'`).
  - «AC-61 / D-60: los mensajes conservan role status y la guía y el motivo de corte tienen role alert» (con `attribute(id, 'role')`).
  - Regresión: tests de sondeo, D-29 (un solo temporizador), D-45 y D-46 de `tests/sidebar.test.js` sin cambios.
- **Verify**: `node --test` (todo pasa; informar recuento); `node --check tests/sidebar-console.test.js tests/fixtures/sidebar-views.js`; `grep -c "setTimeout(" src/Sidebar.html` = 2; `git diff --check` sin salida; `git diff --exit-code 0a0a028 -- src/appsscript.json src/*.js` sin salida. Commit sugerido: `feat(sidebar): consola de ejecución con registro por fila y conciliación`.

### Step 7: Contextual Intelligence y accesibilidad restante (fase 6, D-58, AC-60, AC-61)

- **Files**: modificar `tests/sidebar-console.test.js`, `tests/fixtures/sidebar-views.js` (si falta alguna variante) y `src/Sidebar.html`.
- **Do**:
  1. Tests primero (ver **Test**).
  2. Ayudas restantes de la tabla "`hintsFor(phase, data)`" (marcado estático con textos completos en español rioplatense y condición exacta): `hint-welcome` (`sin-configurar`, `state.panel !== null` y `panel.current === null`), `hint-no-drafts` (`state.panel !== null` y `drafts.length === 0`), `hint-configured`, `hint-test-optional`, `hint-test-row` con `<span id="hint-test-row-list">` (hasta 5 filas `N (email)` de `lastValidation.rows`, luego `y N más`, por `textContent`), `hint-test-done` (`terminada` y `state.run.kind === 'test'`). `hintsFor` nunca lee `panel.drafts` ni `panel.current` con `state.panel === null` y no compara textos del servidor.
  3. Estados vacíos: con `getPanelState` fallido, mensaje en `config-message`, fase `sin-configurar` y sin `hint-welcome`; se conserva el aviso actual `No hay borradores en tu cuenta de Gmail…`.
  4. Accesibilidad restante: `label for` en cada control del formulario y casilla, `aria-describedby` estático hacia las ayudas fijas del formulario, `:focus-visible` definido (desde el paso 2; verificar).
- **Test** (títulos de "Escenarios de prueba > Contextual Intelligence"):
  - «AC-60 / D-58: primera apertura sin configuración muestra hint-welcome; con configuración no».
  - «AC-60: sin borradores muestra hint-no-drafts» (y con `getPanelState` fallido ni `hint-welcome` ni `hint-no-drafts`, sin excepciones).
  - «AC-60: cada ayuda aparece solo con su condición»: tabla fase/datos → `deepEqual` de la lista exacta de `hint-*` visibles, cubriendo todas las ayudas de la tabla (incluidas las de los pasos 4 a 6).
  - «AC-60: las ayudas no comparan textos del servidor» (un `reason` o `detail` arbitrario no cambia las ayudas visibles).
  - «AC-61: todos los controles tienen label for y el CSS define :focus-visible» (estático sobre `src/Sidebar.html`: cada `<input` y `<select` con id tiene un `<label for="id">`).
  - Regresión: suite completa, incluidos los 32 tests de `tests/sidebar.test.js`.
- **Verify**: `node --test` (todo pasa; informar recuento); `node --check tests/sidebar-console.test.js tests/fixtures/sidebar-views.js`; `grep -nE "innerHTML|setInterval|requestAnimationFrame|<link|@import|url\(\"?http" src/Sidebar.html` sin salida; `grep -c "setTimeout(" src/Sidebar.html` = 2; `git diff --check` sin salida; `git diff --exit-code 0a0a028 -- src/appsscript.json src/*.js` sin salida. Commit sugerido: `feat(sidebar): ayudas contextuales y estados vacíos`.

### Step 8: Vista previa local de la sidebar (fase 7, primer commit, D-59)

- **Files**: crear `tools/preview-sidebar.js`; modificar `tests/fixtures/sidebar-views.js` solo si faltan variantes para los 13 estados (por ejemplo `lista-500`).
- **Do**:
  1. `tools/preview-sidebar.js` (CommonJS, solo `node:fs` y `node:path`, sin dependencias) según "Vista previa local (D-59)": `node tools/preview-sidebar.js [estado]` lee `src/Sidebar.html`, carga `tests/fixtures/sidebar-views.js` con `require`, arma en Node las respuestas de cada estado (`inicial`, `sin-borradores`, `configurada`, `setup`, `bloqueada`, `lista`, `prueba`, `envio`, `consentimiento`, `enviando`, `terminada`, `revisar`, `incierta`), las incrusta como JSON reemplazando cada `<` por la secuencia literal `<` (seis caracteres: barra invertida, `u003c`; JSON válido que el navegador decodifica a `<` al parsearlo), e inserta antes del `<script>` original un `<script>` que define `window.google = { script: { run: <falso encadenable con withSuccessHandler/withFailureHandler>, host: { close() {} } } }`, que responde con `setTimeout` de 400 ms según `?state=`, más una barra fija fuera del panel de 300 px para cambiar de estado; `expiresAtIso` se calcula al cargar a partir de minutos relativos.
  2. Escribe `tmp/sidebar-preview.html` (crea `tmp/` si no existe; `tmp/` ya está en `.gitignore`, que no se modifica). No toca `src/` ni ningún otro archivo; no se sube a Apps Script.
- **Test**: sin tests automáticos (herramienta manual, AC-64). Comprobación: `node tools/preview-sidebar.js` crea `tmp/sidebar-preview.html`; el archivo tiene exactamente un `</script>` más que `src/Sidebar.html` (ninguno dentro del JSON incrustado, comprobable con un fixture que contenga `</script>` y verificando que en `tmp/sidebar-preview.html` aparezca `</script>` y no `</script>` dentro del bloque de datos); `git status --short` no muestra `tmp/`. La apertura en navegador a 300 px es manual y no se declara hecha.
- **Verify**: `node --test` (todo pasa; mismo recuento que el paso 7); `node --check tools/preview-sidebar.js tests/fixtures/sidebar-views.js`; `node tools/preview-sidebar.js && ls tmp/sidebar-preview.html`; `git diff --exit-code -- src/` sin salida; `git diff --check` sin salida. Commit sugerido: `chore(tools): vista previa local de la sidebar con estados ficticios`.

### Step 9: Documentación de Eclipse Console (fase 7, segundo commit, D-49, D-52)

- **Files**: modificar `README.md`, `docs/OPERATIONS.md`, `docs/ACCEPTANCE_STATUS.md`, `docs/DECISIONS.md`, `docs/PRODUCT.md`, `AGENTS.md`, `plans/2026-11-09_mail-merge-v2.md`.
- **Do**:
  1. `docs/DECISIONS.md`: D-49 a D-60 con fecha de aprobación 2026-11-14 y el contenido de la tabla "Decisiones de implementación" sin cambios de fondo; D-25 marcada como modificada por D-49 en lo que respecta a la presentación.
  2. `docs/OPERATIONS.md`: sección "El panel Mail Merge" reescrita para Eclipse Console (cabecera, riel, cuatro pasos en acordeón, radar, compuertas y `Falta: …`, vencimiento como hora fija, consola, ayudas), conservando las citas literales de "Invariantes"; checklist en vivo con los ítems 22 a 26 de "Pendiente de validación en vivo"; checklist visual de la vista previa (13 estados a 300 px, sin desplazamiento horizontal, foco visible, chips legibles, `lista-500`) con la aclaración de que no valida lo que HtmlService ignora o reescribe ni reemplaza los ítems 22 a 26.
  3. `docs/ACCEPTANCE_STATUS.md`: AC-56 a AC-64 con el título exacto de cada test que los cubre (AC-64 manual, registrada como ejecutada solo si ocurrió), el resultado real de `node --test` y la vista previa descripta, no capturada; `LOCAL_VERIFIED` solo para lo ejecutado y lo de Google como `PENDING LIVE VALIDATION`.
  4. `README.md`: identidad Mail Merge ZB — Eclipse Console, qué hace, estados de `Resultado`, límites, instalación reproducible como **script vinculado** según "Estrategia de integración con Sheets y preparación para GitHub" (editor de Apps Script; `clasp` descripto y nunca ejecutado, con `create-script --parentId` y la salvedad sobre los alias `create`/`clone`; consentimiento y scopes; no es complemento de Marketplace), vista previa local, verificación local, estructura (`tools/`, `tests/fixtures/sidebar-views.js`, `tests/sidebar-console.test.js`), licencia a definir por el usuario; capturas solo si existen en `docs/screenshots/` (no se crean imágenes).
  5. `docs/PRODUCT.md`: una línea en "Chosen defaults" (la sidebar es la única interfaz y su diseño es Eclipse Console, D-49). `AGENTS.md`: "Estado del proyecto" y "Fuentes vigentes" agregan este plan como diseño vigente de la interfaz, sin tocar las demás reglas. `plans/2026-11-09_mail-merge-v2.md`: nota al inicio de "Detalle del código > Sidebar" (reemplazada en lo visual por este plan, D-49) y corrección de la tabla de funciones públicas a `executeSendPending(token, overwriteConsent, filterAcknowledged)`.
  6. No se tocan `docs/REQUIREMENTS_DRAFT.md`, `docs/ACCEPTANCE.md`, `docs/ENGINEERING_PLAYBOOK.md`, `docs/REFERENCE_AUDIT.md` (el prompt de arranque V1 fue retirado posteriormente, D-65).
- **Test**: sin código nuevo; la suite sigue en verde y cada título de test citado en `docs/ACCEPTANCE_STATUS.md` existe literalmente en `tests/` (comprobar con `grep -F`).
- **Verify**: `node --test` (todo pasa; anotar el recuento real en `docs/ACCEPTANCE_STATUS.md`); `git diff --check` sin salida; `git diff --stat` solo muestra los siete archivos; `git remote -v` vacío. Commit sugerido: `docs: documentar Eclipse Console, instalación como script vinculado y criterios AC-56 a AC-64`.

### Step 10: Revisión independiente y cierre (fase 8)

- **Files**: ninguno por defecto; solo `docs/ACCEPTANCE_STATUS.md` si los resultados finales reales difieren de lo registrado en el paso 9.
- **Do**:
  1. Ejecutar la verificación completa de la sección "Verificación" y anotar las salidas reales.
  2. Lanzar un subagente de solo lectura "Visual & Accessibility Reviewer" con la checklist de 20 puntos de la auditoría (contraste, foco, `aria-live`/`role`, reduced-motion, 300 px, literales, ids, invariantes, timers, inserción de datos, punto único de envío); no corrige nada.
  3. Si hay hallazgos, no aplicarlos en este paso: proponer al usuario el comando exacto `/spec-driven-dev:small-change` con la lista de hallazgos (commits `fix(sidebar): …`, uno por vez sobre `src/Sidebar.html`).
  4. Actualizar `docs/ACCEPTANCE_STATUS.md` con los resultados reales solo si cambiaron; informe de cierre según `AGENTS.md` (archivos y commits, resultados reales, criterios AC-56 a AC-64 cubiertos, riesgos, **comprobado localmente**, **pendiente en Google** con los ítems 13, 17, 20 y 22 a 26, y **no probado**, incluida la vista previa si nadie la abrió).
- **Test**: sin tests nuevos; suite completa en verde.
- **Verify**: `node --test` (todo pasa; recuento real); `node --check tests/helpers/fake-dom.js tests/sidebar.test.js tests/sidebar-console.test.js tests/fixtures/sidebar-views.js tests/ui.test.js tools/preview-sidebar.js`; `git diff --exit-code 0a0a028 -- src/appsscript.json src/Attachments.js src/Config.js src/Confirmation.js src/Preflight.js src/Send.js src/Services.js src/Setup.js src/Sheet.js src/Template.js src/Ui.js` sin salida; `grep -nE "innerHTML|setInterval|requestAnimationFrame|<link|@import|url\(\"?http" src/Sidebar.html` sin salida; `grep -c "setTimeout(" src/Sidebar.html` = 2; `git diff --check`, `git status --short`, `git remote -v` (vacío), `git ls-files | grep -iE "clasp|credential|token|\.pem|\.key"` (vacío). Sin commit propio si no hay cambios; si se actualiza `docs/ACCEPTANCE_STATUS.md`, commit sugerido: `docs(acceptance): registrar la verificación final de Eclipse Console`.

## Nota posterior al cierre del plan (2026-11-15)

Las decisiones D-49 a D-60 y los commits de esta implementación se conservan como evidencia histórica. La preparación para la publicación posterior se registra en `docs/DECISIONS.md` (D-64 a D-67): licencia MIT, retiro del prompt inicial, eliminación de rutas personales, grilla de contadores de dos columnas y simulador local que respeta los bloqueos de validación. El responsable confirmó la visualización del panel en Google Sheets y envíos reales el 2026-11-15; esa evidencia no implica que todos los escenarios manuales del plan hayan sido verificados.
