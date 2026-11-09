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
| Column | Meaning | Initial decision |
|---|---|---|
| `Email Address` | Destination of one email per row | Required, exact name |
| `File Attachments` | Comma-separated Drive links, each belonging to the row | Optional, strict validation |
| `Mail Merge Status` | Existing add-on status / new send state | Preserve and never silently clear |
| `Scheduled Date` | Legacy deferred sending | May exist; **do not schedule in V1** |
| Any other column | Variable `{{Exact header}}` | Preserve displayed text and formatting-relevant characters safely |

Existing `SKIP`, `Email Sent` and any other nonblank status are **not eligible** by default. A manually hidden or filtered-out row is not eligible. Missing or ambiguous columns must fail validation before sending. Do not silently guess recipient columns.

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

**Needs future live verification:** exact alias and quota behavior for the executing account; actual email appearance (including inline images and Gmail signature); permissions for native Docs export; the final workflow used by operators. None of these blocks offline construction but they block production approval.
