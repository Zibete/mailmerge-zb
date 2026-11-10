# Decisions and pending assumptions

Record actual changes in the canonical decision artifacts of `spec-driven-dev`; use this file only for project-level boundary decisions that must survive sessions. Do not expand scope to resolve hypothetical needs.

| Decision | Current status | Reason |
|---|---|---|
| Replace the essential mail-merge workflow, not the commercial add-on's whole feature catalog | APPROVED SCOPE | Familiar workflow, minimal maintenance burden |
| Develop/test on local machine; Git repository stays local and has no remote | HARD CONSTRAINT | External activity is not authorized |
| Use native Sheets + Gmail drafts + Drive + Apps Script | DESIGN DEFAULT | Fits source documentation; no backend required |
| Use a specific selected Gmail draft instead of subject-only lookup | DESIGN DEFAULT | Avoid ambiguous draft selection |
| Keep `Email Address`, `File Attachments`, `Mail Merge Status`, `SKIP` and hidden row semantics | COMPATIBILITY REQUIREMENT — `Mail Merge Status` REEMPLAZADO por `Resultado` (D-31, aprobada 2026-11-09); el resto sigue vigente | Preserve operator workflow |
| Use strict per-row attachment validation, no silent omission | SAFETY REQUIREMENT | Wrong/incomplete attachments are unacceptable |
| Only blank status newly eligible; nonblank rows require explicit human resolution | SAFETY REQUIREMENT | Preserve historic state and avoid duplicates |
| Minimal menu, sidebar only if necessary | DESIGN DEFAULT — MODIFICADA por D-25 (2026-11-09): menú de un ítem y la sidebar como única interfaz | Avoid UI overbuild |
| No auto scheduling or auto retry of uncertain sends | OUT OF SCOPE | Reduces irreversible failure modes |
| Future `clasp` deployment and live OAuth authorization | DEFERRED | Local-only assignment |
| One executable pure-logic offline test suite with mock Google adapters | ACCEPTANCE REQUIREMENT | Runtime and service behavior can be reviewed without Google credentials |

## Decisiones aprobadas por el usuario (2026-11-08)

| Decisión | Estado | Motivo |
|---|---|---|
| La raíz del proyecto es `mailmerge_sdd_local/`, con Git local en la rama `main` y sin remotos | APROBADA | Límite local; los agentes de la skill leen `./CLAUDE.md` |
| Se conservan `SKIP`, `Email Sent` y los encabezados originales; los estados y marcas nuevos son `ENVIANDO`, `REVISAR` y `[PRUEBA]` (reemplazan a `SENDING`, `REVIEW` y `[TEST]` de los borradores) | APROBADA — encabezados REEMPLAZADOS por D-31 (2026-11-09): `Fecha`, `Campaña`, `Resultado`, `Detalle`; los estados y `[PRUEBA]` no cambian | Compatibilidad con el complemento e interfaz en español |
| Un único plan canónico generado por `spec-driven-dev` en `plans/` | APROBADA | Evitar especificaciones paralelas |
| Todo el desarrollo, la documentación y la interfaz en español; identificadores técnicos en inglés | APROBADA | Requisito del usuario |
| Node.js portable v20.11.1 (`C:\Users\matias.peralta_exter\nodejs\node-v20.11.1-win-x64`), PATH solo por proceso, sin dependencias | APROBADA | No modificar el sistema ni sumar herramientas |
| Desarrollo y pruebas solo locales: sin despliegues, OAuth ni envíos reales | APROBADA | Ratifica el límite de `AGENTS.md` |
| Confirmación con `Ui.alert` fuera del lock; después del "Sí" se toma el lock, se relee y revalida todo y solo se envían filas idénticas a las confirmadas | APROBADA (2026-11-09) — REEMPLAZADA por D-26 y D-28 (2026-11-09): confirmación en la sidebar con token de un solo uso, también fuera del lock | `Ui.alert` suspende la ejecución y no se asume que el lock se conserve; evita carreras y duplicados (plan, "Enfoque" punto 3) |
| La validación y la confirmación muestran, por fila, destinatario y nombres de adjuntos (nunca URLs), hasta 20 filas y luego `y N filas más`, más los adjuntos comunes | APROBADA (2026-11-09) — MODIFICADA por D-42 (2026-11-09): se listan todas las filas, hasta 500 | Mitiga que un editor del Sheet combine un archivo privado con una dirección externa sin que el operador lo vea (plan, D-23) |
| Scopes `https://mail.google.com/` y `drive.readonly` | RIESGO ACEPTADO SOLO PARA DESARROLLO LOCAL (2026-11-09) | Son amplios y restringidos, pero son la combinación mínima documentada para `GmailApp`/`DriveApp`. **Pendiente de autorización explícita y validación en vivo antes de cualquier uso real** (plan, D-24) |

## Decisiones de la V2 (2026-11-09)

Fuente: `plans/2026-11-09_mail-merge-v2.md`, sección "Decisiones de implementación", donde está el texto completo de cada una. Estado:

- **APROBADA (2026-11-09):** el usuario la aprobó en forma explícita.
- **REVISADA (2026-11-09):** decisión técnica del plan, revisada por el usuario antes de implementar.

| ID | Decisión | Estado | Motivo |
|---|---|---|---|
| D-25 | Menú `Mail Merge` con un solo ítem, `Abrir Mail Merge`, que abre la sidebar; se eliminan los ítems y controladores de la V1 y `createUi_` | REVISADA (2026-11-09) | Todo el flujo en la sidebar, sin `Ui.alert` ni `Ui.prompt` |
| D-26 | La confirmación se traslada con un token `Utilities.getUuid()` y un snapshot en `CacheService.getUserCache()`, con vencimiento de 10 min (`CONFIRM_TTL_MS`) comprobado con el reloj y con el TTL de la caché | REVISADA (2026-11-09) | Mínima, sin secretos, aislada por usuario (alternativa B del plan) |
| D-27 | El snapshot guarda digests SHA-256 de la plantilla y de cada fila, nunca valores de filas ni contenido de la plantilla; sí datos de cuenta y configuración (cuenta que ejecuta, `testTo`, `from`, `replyTo`, `sheetId`, `draftId`, campaña), números de fila, la huella de D-48 y las filas a sobrescribir de D-47 | REVISADA (2026-11-09) | Snapshot muy por debajo de 100 KB y sin datos de destinatarios ni del correo |
| D-28 | El snapshot es de un solo uso: se borra bajo el lock antes de cualquier escritura o envío; si el borrado falla, no se envía nada; un snapshot rechazado también se borra | REVISADA (2026-11-09) | Un doble clic o una segunda pestaña no reutilizan una confirmación |
| D-29 | Progreso publicado en caché (`MM_PROG_<token>`, 30 min) al empezar, por fila y al terminar; la sidebar lo sondea cada 2 s, una llamada por vez | REVISADA (2026-11-09) | Progreso real conservando una sola ejecución con el lock tomado |
| D-30 | `MAX_RUNTIME_MS` se mide desde el inicio de la llamada que envía. **Reemplaza D-12** | REVISADA (2026-11-09) | La confirmación ya no ocurre dentro de la ejecución que envía |
| D-31 | Columnas gestionadas `Fecha`, `Campaña`, `Resultado`, `Detalle` en la pestaña de la campaña; `Mail Merge Status` y `Scheduled Date` pasan a ser encabezados heredados que solo reconoce la migración. **Reemplaza D-01 en lo que respecta a encabezados, D-03, D-17 y D-18** | APROBADA (2026-11-09) | Resultados en la misma pestaña; modificación de contrato de literales aprobada |
| D-32 | La pestaña `Registro Mail Merge` existente no se escribe, no se borra, no se ofrece como campaña y sus datos no se migran | REVISADA (2026-11-09) | Sin pérdida del historial de la V1 |
| D-33 | "Preparar columnas": renombra en el lugar `Mail Merge Status` → `Resultado` y `Scheduled Date` → `Fecha`, agrega las gestionadas que falten a la derecha del área usada, bajo el lock y con compare-and-set; escribe primero `Resultado` (renombrado o agregado) y es idempotente | REVISADA (2026-11-09) | Crear columnas de forma segura y reanudable, sin desplazar datos |
| D-34 | La migración se bloquea sin escribir en los casos (a) a (e): heredado y reemplazo juntos; V1 con `Fecha` / `Campaña` / `Detalle` propia; `Scheduled Date` con valor y estado vacío; columna propia sin heredadas ni `Resultado`; columna con valores en filas con `Resultado` vacío cuando falta alguna gestionada | APROBADA (2026-11-09) | No volver enviables filas excluidas ni pisar datos del operador |
| D-35 | La validación exige las cuatro gestionadas y `Email Address`; con heredadas o faltantes devuelve un plan de columnas; un marcador que referencia una columna gestionada es error global | REVISADA (2026-11-09) | Validar sigue siendo de solo lectura; las gestionadas cambian durante el envío |
| D-36 | La clave de fila excluye `Fecha`, `Campaña` y `Detalle` (incluye `Resultado`). **Modifica D-14** | REVISADA (2026-11-09) | El script escribe esas columnas y su texto mostrado depende del formato |
| D-37 | Escrituras por transición con `writeCells` y `Resultado` siempre último: claim (`Fecha`, `Campaña`, `Detalle`, `ENVIANDO`), éxito (`Detalle`, `Email Sent`), excepción (`Detalle`, `REVISAR`); sin escrituras para filas omitidas, claim fallido o fila desplazada | REVISADA (2026-11-09) | Un corte a mitad de transición deja el estado anterior seguro |
| D-38 | Lo que se escribe en la hoja se neutraliza (`'` ante `=`, `+`, `-`, `@`); `Detalle` en una línea, sin URLs, hasta 300 caracteres | REVISADA (2026-11-09) | Mismo contrato de minimización que el registro V1 |
| D-39 | Nombre de campaña opcional por usuario (`MM_CAMPAIGN_NAME`, hasta 80 caracteres, saneado); si está vacío se genera un ID de 8 caracteres por confirmación | APROBADA (2026-11-09) | Nombre de campaña opcional (pedido V2, punto 4); un ID por confirmación conserva la semántica V1 de un ID por ejecución |
| D-40 | La prueba solo admite una fila elegible y válida, pasa por el mismo motor y deja `Resultado = Email Sent` con un `Detalle` de prueba. **Reemplaza D-07** | REVISADA (2026-11-09) | Prueba con rastro en la fila sin pisar resultados existentes |
| D-41 | Tope de 500 filas por confirmación y de 90 KB por valor en caché; si se supera, no se prepara nada y se pide enviar por tandas | REVISADA (2026-11-09) | Cota del valor de caché de 100 KB con margen |
| D-42 | Validación y confirmación listan todas las filas a enviar (hasta 500) con destinatario y adjuntos. **Modifica D-23** | REVISADA (2026-11-09) | La sidebar permite desplazarse; confirmar sin ver todas las filas debilitaba la revisión |
| D-43 | La configuración al ejecutar tiene que ser idéntica a la del snapshot (`sheetId`, `draftId`, `from`, `replyTo`, `campaignName`); si no, se cancela todo; D-15 se mantiene con el digest de la plantilla | REVISADA (2026-11-09) | Otra pestaña del navegador puede cambiar la configuración entre preparar y confirmar |
| D-44 | Las funciones públicas reciben datos mínimos y devuelven JSON plano saneado; la sidebar solo usa `textContent` / `new Option`; el cliente nunca envía filas ni digests | REVISADA (2026-11-09) | `google.script.run` solo transporta JSON y el cliente no es confiable |
| D-45 | Sin reintentos: un solo `execute…` por token; ante una falla de transporte se muestra el último progreso y la guía de revisar `Resultado`; con lock no disponible el snapshot no se consume y la sidebar vuelve al inicio | REVISADA (2026-11-09) | Un reintento automático podría duplicar envíos |
| D-46 | El progreso en caché no guarda destinatarios y redacta toda dirección de correo como `[dirección]`; `SendResultView` (no se guarda) sí trae `recipient` | APROBADA (2026-11-09) | Minimización de lo que dura 30 min en la caché |
| D-47 | Consentimiento obligatorio para reemplazar valores existentes de `Fecha`, `Campaña` o `Detalle` en una hoja completa: casilla sin marcar que identifica columnas y filas, y verificación en el servidor (`overwriteConsent === true`) | APROBADA (2026-11-09) | Es el flujo normal después de una prueba; no se destruyen datos sin consentimiento identificado |
| D-48 | Huella independiente de `Fecha`, `Campaña` y `Detalle` por fila: si cambia después de confirmar, la fila se omite sin escribir y la ejecución sigue | APROBADA (2026-11-09) | El consentimiento no cubre datos que no existían al confirmar |

### Decisiones de la V1 reemplazadas o modificadas por la V2

Las decisiones `D-01` a `D-24` están en `plans/2026-11-08_mail-merge-v1.md` y siguen vigentes salvo estas:

| ID V1 | Decisión V1 | Estado en la V2 |
|---|---|---|
| D-01 | Literales: encabezados `Email Address`, `File Attachments`, `Mail Merge Status`, `Scheduled Date`; estados y `[PRUEBA] ` | **REEMPLAZADA en lo que respecta a encabezados** por D-31; los estados `SKIP`, `Email Sent`, `ENVIANDO`, `REVISAR` y el prefijo `[PRUEBA] ` siguen vigentes |
| D-03 | Elegible solo con `Mail Merge Status` vacío y `Scheduled Date` vacío | **REEMPLAZADA** por D-31: solo `Resultado` vacío decide; D-34 (c) evita que la migración vuelva enviables las filas con `Scheduled Date` |
| D-07 | La prueba ignora estado y visibilidad y nunca escribe estado | **REEMPLAZADA** por D-40 |
| D-12 | El presupuesto de tiempo se mide desde el inicio de la ejecución, antes del diálogo | **REEMPLAZADA** por D-30 |
| D-14 | La clave de fila es el JSON de todos los valores mostrados | **MODIFICADA** por D-36: excluye `Fecha`, `Campaña` y `Detalle` |
| D-17 | Registro en la pestaña `Registro Mail Merge` | **REEMPLAZADA** por D-31 (resultados en las columnas gestionadas) y D-32 (la pestaña existente queda intacta) |
| D-18 | Una falla del registro no detiene el envío | **REEMPLAZADA** por D-31: ya no hay registro aparte; `Resultado` es la única fuente de verdad |
| D-23 | Revisión por fila hasta 20 filas | **MODIFICADA** por D-42: hasta 500 filas |

## Open questions: conservative defaults
1. **Do operators use a Google Doc as the message source?** Until evidenced otherwise, use Gmail draft as source; do not implement Google Docs editor/import.
2. **Is `Scheduled Date` actively used?** Do not schedule automatically. If populated, flag/exclude it until a separate approved requirement clarifies desired behavior; do not send early. **Resuelta en la V2 (D-31, D-34 c):** `Scheduled Date` se renombra a `Fecha` y deja de decidir la elegibilidad; "Preparar columnas" se bloquea mientras haya filas con `Scheduled Date` y estado vacío.
3. **Are CC/BCC required?** Omit in V1 unless the installed skill captures a proven user need; support Reply-To and authorized alias only if feasible with existing Apps Script APIs.
4. **What constitutes an optional empty placeholder?** Default referenced fields to required/nonempty. Only relax this with documented examples and tests.
5. **What is the actual sender's Workspace quota?** Never hardcode; read API in future runtime; keep limits configurable in offline tests.

If a question cannot be answered with provided sources, implement the safe default and mark it `ASSUMPTION`; do not invent business practice or silently copy an unverified behavior.
