# Acceptance matrix — local-first V1

**Purpose:** measurable tests for the installed spec-driven-dev skill. Test names (`AC-xx`) should remain stable; the skill may transform their format but must preserve meaning and traceability. No live email or external account access in this assignment.

## Fixture (synthetic, offline)
A fake Sheet `Recipients` with `Email Address`, `First Name`, `Reference`, `File Attachments`, `Mail Merge Status`, `Scheduled Date`. Use `alpha@example.test`, `beta@example.test`, `gamma@example.test`; never client data. A fake Gmail draft contains subject `Notice {{Reference}}`, HTML with `{{First Name}}`, one inline image and one shared fake PDF blob. Fake Drive contains two distinct PDF blobs and one native document simulated for PDF export. All Google interfaces must be mocked locally.

## Automated acceptance cases
| ID | Test input | Expected result | R |
|---|---|---|---|
| AC-01 | Two synthetic rows, different variable values | Subjects and bodies differ correctly, no cross-row leakage | R01-03 |
| AC-02 | Placeholder value includes `<script>`, ampersand, quotes, newline | Script is escaped in HTML; headers cannot contain CR/LF injection | R03 |
| AC-03 | Unknown `{{Not a column}}` in template | Row blocked; missing field reported, not replaced with empty string | R03 |
| AC-04 | Required token exists but row value is empty | Row blocked with actionable reason | R03 |
| AC-05 | Two Drive URLs separated by comma | Exactly those two files are attached to that destination | R05 |
| AC-06 | One common draft attachment + row-specific attachment | Both included; other row's file never included | R02, R05 |
| AC-07 | Missing/unauthorized Drive file | No mail call; row validation failure visible | R05 |
| AC-08 | Native Google document link | PDF conversion performed via mocked export contract, filename/MIME correct | R05 |
| AC-09 | Blob/file exceeds configured safe limit | No mail call; actionable error | R05 |
| AC-10 | `SKIP`, `Email Sent`, `REVIEW`, `SENDING` or arbitrary nonblank status | All excluded from new automatic send | R06 |
| AC-11 | Hidden-by-user or hidden-by-filter row | Excluded from preflight and send | R06 |
| AC-12 | Duplicate header or missing email/status column | Preflight fails; no sending | R01 |
| AC-13 | Invalid recipient | Invalid row blocked before provider API | R04 |
| AC-14 | Alias not authorized | Preflight/confirmation blocked, no real send call | R04 |
| AC-15 | Trial send for selected row | Same rendered payload & attachments as production; only recipient and `[TEST]` differ | R08 |
| AC-16 | Trial send with one missing attachment | Fails closed; row status unchanged; no provider call | R05, R08 |
| AC-17 | No explicit confirmation | No send | R07, R09 |
| AC-18 | Two simultaneous executions | One lock-holder only, one send at most | R10 |
| AC-19 | Crash after `SENDING` checkpoint but before mail call | Manual-review state; no automatic retry | R11 |
| AC-20 | Crash after mock mail accepted but before success persist | Ambiguous state retained; no automatic retry | R11 |
| AC-21 | Mock service exception with uncertain send outcome | Not marked safely unsent; manual review | R11 |
| AC-22 | Near runtime/quota limit | Stops gracefully, safe unclaimed rows remain eligible | R12 |
| AC-23 | User edits destination or file link after preflight | Confirmation invalidated or row rechecked; altered data not sent unnoticed | R07 |
| AC-24 | User switches active tab or reorders rows | Stable explicit tab/row identity prevents wrong-row send or blocks stale snapshot | R01, R07 |
| AC-25 | Re-run after confirmed success | Already sent rows excluded, zero duplicate sends | R06, R11 |
| AC-26 | Log after successful mock mail call | Timestamp/reference/outcome; no raw body, private Drive URLs or unnecessary row dump | R13 |
| AC-27 | Preview/preflight only | Zero send calls, zero unexpected writes to status | R07, R14 |
| AC-28 | Manifest/scopes review | Only justified Google scopes; no unrelated services or credentials | R15 |
| AC-29 | Local Git repository / no remote | `git remote -v` empty, local commits traceable, no secrets tracked | R15 |
| AC-30 | Offline test command | All tests run without Google auth, Google file IDs, or network access | R15 |

## Verification protocol
1. Run deterministic unit tests for tokens, HTML, header sanitization, Drive URL parsing, row visibility/status, recipient format, source row identity.
2. Run integration tests with a **mock** Sheets/Gmail/Drive/Clock/Lock layer; assert call order and *absence of mail calls* on any blocking condition.
3. Test interruption windows around claim, Gmail acceptance and status persist; verify manual review rather than unsafe automatic resends.
4. Inspect Apps Script manifest and project layout; run syntax/lint checks locally if configured.
5. Run `git diff --check`, review staged changes and `git status`; record the actual local test command and output summary.
6. Report acceptance coverage as `PASS (local mock)`, `FAIL` or `PENDING LIVE VALIDATION`. Never call a mocked mail send a live end-to-end test.

## Deferred live/manual acceptance (not part of local development)
- Install/link the bound script in an approved test Sheet, review OAuth scopes and sender aliases.
- Verify a real test email's HTML, inline image and signature/attachments in a designated authorized test mailbox.
- Verify Gmail/Drive behavior, quotas, hidden rows, native conversion and user confirmation in Apps Script runtime.
- Obtain required permissions and written approval before a real external campaign.

**Two explicit definitions of done:** `LOCAL_VERIFIED` (this assignment) vs `LIVE_VERIFIED` (future authorized process). Do not conflate them.
