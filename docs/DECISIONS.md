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

## Open questions: conservative defaults
1. **Do operators use a Google Doc as the message source?** Until evidenced otherwise, use Gmail draft as source; do not implement Google Docs editor/import.
2. **Is `Scheduled Date` actively used?** Do not schedule automatically. If populated, flag/exclude it until a separate approved requirement clarifies desired behavior; do not send early.
3. **Are CC/BCC required?** Omit in V1 unless the installed skill captures a proven user need; support Reply-To and authorized alias only if feasible with existing Apps Script APIs.
4. **What constitutes an optional empty placeholder?** Default referenced fields to required/nonempty. Only relax this with documented examples and tests.
5. **What is the actual sender's Workspace quota?** Never hardcode; read API in future runtime; keep limits configurable in offline tests.

If a question cannot be answered with provided sources, implement the safe default and mark it `ASSUMPTION`; do not invent business practice or silently copy an unverified behavior.
