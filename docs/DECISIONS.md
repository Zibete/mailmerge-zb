# Decisions and pending assumptions

Record actual changes in the canonical decision artifacts of `spec-driven-dev`; use this file only for project-level boundary decisions that must survive sessions. Do not expand scope to resolve hypothetical needs.

| Decision | Current status | Reason |
|---|---|---|
| Replace the essential mail-merge workflow, not the commercial add-on's whole feature catalog | APPROVED SCOPE | Familiar workflow, minimal maintenance burden |
| Develop/test on local machine; Git repository stays local and has no remote | HARD CONSTRAINT | External activity is not authorized |
| Use native Sheets + Gmail drafts + Drive + Apps Script | DESIGN DEFAULT | Fits source documentation; no backend required |
| Use a specific selected Gmail draft instead of subject-only lookup | DESIGN DEFAULT | Avoid ambiguous draft selection |
| Keep `Email Address`, `File Attachments`, `Mail Merge Status`, `SKIP` and hidden row semantics | COMPATIBILITY REQUIREMENT | Preserve operator workflow |
| Use strict per-row attachment validation, no silent omission | SAFETY REQUIREMENT | Wrong/incomplete attachments are unacceptable |
| Only blank status newly eligible; nonblank rows require explicit human resolution | SAFETY REQUIREMENT | Preserve historic state and avoid duplicates |
| Minimal menu, sidebar only if necessary | DESIGN DEFAULT | Avoid UI overbuild |
| No auto scheduling or auto retry of uncertain sends | OUT OF SCOPE | Reduces irreversible failure modes |
| Future `clasp` deployment and live OAuth authorization | DEFERRED | Local-only assignment |
| One executable pure-logic offline test suite with mock Google adapters | ACCEPTANCE REQUIREMENT | Runtime and service behavior can be reviewed without Google credentials |

## Decisiones aprobadas por el usuario (2026-11-08)

| Decisión | Estado | Motivo |
|---|---|---|
| La raíz del proyecto es `mailmerge_sdd_local/`, con Git local en la rama `main` y sin remotos | APROBADA | Límite local; los agentes de la skill leen `./CLAUDE.md` |
| Se conservan `SKIP`, `Email Sent` y los encabezados originales; los estados y marcas nuevos son `ENVIANDO`, `REVISAR` y `[PRUEBA]` (reemplazan a `SENDING`, `REVIEW` y `[TEST]` de los borradores) | APROBADA | Compatibilidad con el complemento e interfaz en español |
| Un único plan canónico generado por `spec-driven-dev` en `plans/` | APROBADA | Evitar especificaciones paralelas |
| Todo el desarrollo, la documentación y la interfaz en español; identificadores técnicos en inglés | APROBADA | Requisito del usuario |
| Node.js portable v20.11.1 (`C:\Users\matias.peralta_exter\nodejs\node-v20.11.1-win-x64`), PATH solo por proceso, sin dependencias | APROBADA | No modificar el sistema ni sumar herramientas |
| Desarrollo y pruebas solo locales: sin despliegues, OAuth ni envíos reales | APROBADA | Ratifica el límite de `AGENTS.md` |
| Confirmación con `Ui.alert` fuera del lock; después del "Sí" se toma el lock, se relee y revalida todo y solo se envían filas idénticas a las confirmadas | APROBADA (2026-11-09) | `Ui.alert` suspende la ejecución y no se asume que el lock se conserve; evita carreras y duplicados (plan, "Enfoque" punto 3) |
| La validación y la confirmación muestran, por fila, destinatario y nombres de adjuntos (nunca URLs), hasta 20 filas y luego `y N filas más`, más los adjuntos comunes | APROBADA (2026-11-09) | Mitiga que un editor del Sheet combine un archivo privado con una dirección externa sin que el operador lo vea (plan, D-23) |
| Scopes `https://mail.google.com/` y `drive.readonly` | RIESGO ACEPTADO SOLO PARA DESARROLLO LOCAL (2026-11-09) | Son amplios y restringidos, pero son la combinación mínima documentada para `GmailApp`/`DriveApp`. **Pendiente de autorización explícita y validación en vivo antes de cualquier uso real** (plan, D-24) |

## Open questions: conservative defaults
1. **Do operators use a Google Doc as the message source?** Until evidenced otherwise, use Gmail draft as source; do not implement Google Docs editor/import.
2. **Is `Scheduled Date` actively used?** Do not schedule automatically. If populated, flag/exclude it until a separate approved requirement clarifies desired behavior; do not send early.
3. **Are CC/BCC required?** Omit in V1 unless the installed skill captures a proven user need; support Reply-To and authorized alias only if feasible with existing Apps Script APIs.
4. **What constitutes an optional empty placeholder?** Default referenced fields to required/nonempty. Only relax this with documented examples and tests.
5. **What is the actual sender's Workspace quota?** Never hardcode; read API in future runtime; keep limits configurable in offline tests.

If a question cannot be answered with provided sources, implement the safe default and mark it `ASSUMPTION`; do not invent business practice or silently copy an unverified behavior.
