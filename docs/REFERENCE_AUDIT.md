# Source-code audit — references for implementation

**Reviewed:** 2026-11-08. Observations distinguish **verified source behavior**, **provider-documented add-on behavior** and **recommended design**. The code is reference material, not vetted production code. Public URLs are provided for read-only research.

## 1. Google Workspace (primary reference)
Repo: https://github.com/googleworkspace/apps-script-samples
Relevant code: https://github.com/googleworkspace/apps-script-samples/blob/main/solutions/automations/mail-merge/Code.js
Official tutorial: https://developers.google.com/apps-script/samples/automations/mail-merge

**Verified in source:** Sheets custom menu; Gmail draft as template; `{{Column}}` substitution; HTML and plain body; inline images; shared attachments; `GmailApp.sendEmail`; status output to Sheet. The sample is Apache-2.0 licensed.

**Weaknesses to address:**
- `getGmailTemplateFromDrafts_(subject_line)` searches drafts by subject and uses the first match; subject collisions are ambiguous.
- It collects statuses in `out` and writes them after the send loop: a crash between Gmail and `setValues` risks repeat sends.
- It lacks strict preflight, attachment-per-row handling, explicit excluded/hidden row semantics, independent status claims, and concurrency control.
- A filter does not restrict which rows the sample emails; it iterates displayed values regardless of visibility.
- The JSON-stringify token replacement is compact but should be verified with escaped quotes, ampersands, control chars and HTML-special data.

**Decision:** adapt the *concept* of its Gmail draft/HTML/inline-image pipeline; implement independent row checks, state persistence and strict attachments.

## 2. chezca-v/mailmergevida (UI + attachments reference)
Repo: https://github.com/chezca-v/mailmergevida
Reviewed: `Code.gs`, `Sidebar.html`, `README.md`. README states MIT; the inspected three-file tree did not expose a standalone license file.

**Verified in source:** sidebar with compose/send/schedule/template/help; Google Sheet header detection; two placeholder syntaxes; Drive link lookup; row-specific attachments; test email; aliases; send log; quota display; schedules via triggers.

**Risks found by code inspection:**
1. `getFileFromDriveUrl` catches errors and returns `null`; send code silently omits missing attachments and may send incomplete messages.
2. `getAs(file.getMimeType())` is not a general correct conversion for Google-native files; differentiate blobs and export-to-PDF.
3. `sendTestEmail` does not attach the files selected for normal send; test is not representative.
4. No cross-call lock in `sendEmails`, so concurrent calls may duplicate sends.
5. Quota UI sets `limit: 500` even when Gmail quota differs; don't present a fabricated account limit.
6. Scheduled send uses the **active sheet** and loops over stored schedules; not a stable campaign identity; trigger cleanup is coarse.
7. `ensureStatusColumn` is sometimes called without the chosen `headerRow`; header/index mapping is brittle.
8. Sidebar inserts sheet/template/error values via `innerHTML` without consistent escaping (including editable row preview).
9. Recipient detection based on matching `mail` is overbroad; file-column detection samples only the first row.
10. Regex is assembled from unsanitized column names; metacharacters can change behavior.
11. README recommends making Drive files accessible to anyone with the link. Do **not** adopt this security shortcut.
12. No test suite was visible in the inspected tree.

**Decision:** borrow small UI/preview concepts only. Never use this send engine or scheduling unchanged.

## 3. bpbraun/mail_merge_google_sheet (defensive reference)
Repo: https://github.com/bpbraun/mail_merge_google_sheet
Reviewed: `Code.gs`, `Tests.gs`, `README.md`, `docs/HOW_TO_USE.md`, `appsscript.json`. MIT license.

**Verified in source:** generates Gmail **drafts, not sends**; rich text templates from a Sheets cell; existing Gmail signature; `LockService.getDocumentLock`; early timeout; per-row status and `SpreadsheetApp.flush`; header sanitization; HTML escaping and tests of deterministic helpers; explicit OAuth scopes.

**Useful patterns:** lock before processing; short time budget; safe string handling; tests isolated from Gmail; operator instructions and permissions explanation. Its test suite exercises actual Apps Script `RichTextValue` for formatting, but that portion is not directly runnable in Node without a stub or Google runtime.

**Do not copy blindly:** draft-only semantics don't fulfill automatic authorized send; the update-after-create window still exists; it only supports a name token and no row-specific attachments; the hard-coded throttle and scopes are not universal defaults.

## 4. labnol/code (small supporting example)
Repo: https://github.com/labnol/code (default branch `google` at inspection)
File: https://github.com/labnol/code/blob/google/google-apps-script/rich-text/code.js

**Verified in source:** turns Sheets `RichTextValue.getRuns()` into HTML with style and link tags, then sends a demonstration message. It is not an open-source copy of the paid add-on. The repo is MIT licensed.

**Risk:** generated HTML interpolates text/link values without complete escaping, so do not reuse directly with imported sheet data.

## 5. Paid add-on: documented compatibility, not source access
Provider: https://digitalinspiration.com/docs/mail-merge
- Attachments: https://digitalinspiration.com/docs/mail-merge/attachments
- Skip rows: https://digitalinspiration.com/docs/mail-merge/skip-rows-for-merge
- Gmail drafts: https://digitalinspiration.com/docs/mail-merge/gmail-draft

**Provider-documented:** `File Attachments` supports multiple Drive links separated by commas; common draft attachment plus a row-specific file; native Google Docs/Sheets/Slides may be exported as PDFs; `SKIP` and `Email Sent` are not re-sent; hidden/filtered rows are excluded. The provider's functionality does not authorize copying any proprietary code or assets.

## 6. Authoritative platform documentation
- Apps Script mail merge: https://developers.google.com/apps-script/samples/automations/mail-merge
- Quotas / execution time / attachment size: https://developers.google.com/apps-script/guides/services/quotas
- `LockService`: https://developers.google.com/apps-script/reference/lock
- `GmailApp`: https://developers.google.com/apps-script/reference/gmail/gmail-app
- `MailApp` remaining recipient quota: https://developers.google.com/apps-script/reference/mail/mail-app
- `DriveApp.File`: https://developers.google.com/apps-script/reference/drive/file
- `clasp` — local development, **separate from local-only deployment restriction**: https://developers.google.com/apps-script/guides/clasp

Quotas and supported API features may change; query current official docs before a future live pilot. The local tests must use configurable thresholds rather than assume a specific organization's quota.

## 7. License and provenance rule
References are for technical understanding. Prefer fresh implementation. If the agent reuses third-party source, it must preserve license notices, record what was reused, confirm license compatibility, and avoid unlicensed redistribution of proprietary add-on code.
