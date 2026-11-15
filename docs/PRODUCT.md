# Product intent — Mail Merge V1

**Status:** product baseline for spec-driven development. Everything below describes an intended workflow, not a completed implementation.

## Problem
A small team currently uses a paid mail merge add-on to send individual, personalized operational notices. Each campaign starts with a Google Sheet, a formatted message template, per-recipient variables and sometimes different Drive attachments. Operators are comfortable with the existing columns and status tracking.

The goal is a **near-equivalent, smaller, locally maintainable alternative**, not a new communications platform. It should be easy to use, safe with attachments and predictable when stopped and resumed.

## Intended workflow
1. Prepare a Sheet with a header row, one destination per row, optional variables and optional Drive links.
2. Prepare a Gmail draft that contains the subject, HTML formatting and `{{Header}}` tokens; optional attachments shared by everyone may be attached to the draft.
3. Select the specific Sheet tab and Gmail draft; choose an authorized sender identity and optional reply-to.
4. **Validate / preview:** determine eligible vs excluded vs invalid rows, missing variables and attachment problems. Never send during this step.
5. **Test:** build one representative email using a selected row and its actual attachments, but redirect it to a designated approved test mailbox. Test sending is disabled in this local-only assignment; mock it.
6. **Confirm / send:** in the eventual Google runtime, show the sender, source tab, draft, number of eligible rows and attachment summary, then require an explicit human confirmation.
7. **Control:** show outcomes in `Mail Merge Status` and a minimal separate log; allow a later run to process only unambiguous pending rows.

## Compatibility contract

**V2 (D-31, aprobada el 2026-11-09):** los resultados viven en cuatro columnas gestionadas de la propia pestaña y la pestaña de registro aparte deja de escribirse (D-32). Las líneas 7 de "Intended workflow" y 3 de "Core acceptance outcomes" describen la intención de la V1: en la V2 la prueba deja `Resultado = Email Sent` en la fila probada (D-40) y no hay registro aparte.

| Columna | Significado | Decisión vigente (V2) |
|---|---|---|
| `Email Address` | Destino de un correo por fila | Obligatoria, nombre exacto |
| `File Attachments` | Enlaces de Drive separados por coma, propios de la fila | Opcional, validación estricta |
| `Resultado` | Estado de envío de la fila (`SKIP`, `Email Sent`, `ENVIANDO`, `REVISAR` u otro texto); reemplaza a `Mail Merge Status` | Obligatoria (columna gestionada). Solo una fila con `Resultado` vacío es elegible; el script nunca cambia un valor existente |
| `Fecha` | Momento en que el script inició el envío de la fila; reemplaza a `Scheduled Date` | Obligatoria (columna gestionada), informativa; no decide la elegibilidad ni programa envíos |
| `Campaña` | Nombre de la campaña o ID generado por confirmación (D-39) | Obligatoria (columna gestionada), informativa |
| `Detalle` | Motivo resumido del resultado, en una línea, sin URLs (D-38) | Obligatoria (columna gestionada), informativa; guía la conciliación de `ENVIANDO` / `REVISAR` |
| `Mail Merge Status` | Estado de la V1 y del complemento | **Heredado**: solo lo reconoce "Preparar columnas", que lo renombra a `Resultado` sin mover los datos; mientras exista, la validación falla |
| `Scheduled Date` | Envío diferido de la V1 y del complemento | **Heredado**: solo lo reconoce "Preparar columnas", que lo renombra a `Fecha`; se bloquea si alguna fila tiene fecha y estado vacío (D-34 c) |
| Cualquier otra columna | Variable `{{Encabezado exacto}}` | Se usa el texto mostrado, con escapado seguro. Las columnas gestionadas no se pueden usar como marcador (D-35) |

Los estados `SKIP`, `Email Sent` y cualquier otro valor no vacío (en la V2, en `Resultado`) **no son elegibles** por defecto. Una fila oculta o filtrada manualmente no es elegible. Las columnas faltantes o ambiguas hacen fallar la validación antes de enviar. Nunca se adivina en silencio la columna de destinatarios.

## Core acceptance outcomes
- Different recipients receive only their intended variables, common attachments and row-specific files.
- Missing/inaccessible Drive files block the row: **never send a message missing a requested attachment**.
- A test uses the same render/attachment pipeline as a real send, except recipient/TEST marker, without altering campaign send status.
- Re-running or double-clicking cannot automatically send an already processed or ambiguous row again.
- A stopped run continues from safe pending rows; uncertain outcomes require explicit manual inspection, not an automated retry.
- The operator can read straightforward validation errors and a concise send summary without a programming background.

## Explicitly out of scope
- Creating or editing documents, generating customized PDFs from templates or discovering files by client name.
- Scheduled/recurring sends, autoresponders, open/click tracking, bounce analytics or a marketing unsubscribe system.
- Independent web frontend, cloud backend, external database, CRM/ERP, browser extension, native desktop client.
- Exceeding Google quotas, impersonation or unaudited sending from unrelated accounts.

## Boundaries / status of assumptions
**Documented behavior of current add-on:** `Email Address`, `File Attachments`, `Mail Merge Status`, `SKIP`, `Email Sent`, hidden-row exclusion, commas between file links, common draft attachments and Google Workspace file-to-PDF conversion. See `REFERENCE_AUDIT.md` for exact sources.

**Chosen defaults for the new tool:** Gmail draft as template; small menu and, only if warranted, a compact sidebar; no scheduling; read-only Drive access; local Git only.

**Interface (2026-11-14, D-49):** the sidebar is the only interface and its design is Eclipse Console (`plans/2026-11-14_eclipse-console-ui.md`): the product identity inside the panel is Mail Merge ZB — Eclipse Console; the menu `Mail Merge → Abrir Mail Merge` is unchanged.

**Needs future live verification:** exact alias and quota behavior for the executing account; actual email appearance (including inline images and Gmail signature); permissions for native Docs export; the final workflow used by operators. None of these blocks offline construction but they block production approval.
