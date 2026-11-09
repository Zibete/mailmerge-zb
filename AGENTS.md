# Engineering contract — local Mail Merge

## Objective and scope
- Build a **small** Google Sheets + Gmail + Drive mail merge, using Apps Script V8. Replace the essential workflow of an existing paid add-on; do not create a marketing platform.
- Source of truth: `docs/PRODUCT.md`, `docs/REQUIREMENTS_DRAFT.md`, `docs/ACCEPTANCE.md`. `docs/REFERENCE_AUDIT.md` is research, not copy-paste production code.
- Prefer native Google capabilities and the smallest implementation that meets the acceptance criteria. No independent web app, server, database, CRM integration, analytics pixels, AI runtime or elaborate framework.

## Local-only boundary (mandatory)
- **All code, tests, specifications and Git activity stay on the local machine.** Local `git init`, branches and small, descriptive local commits are allowed. Do not add a Git remote, push, create a PR, publish or release.
- Do not run `clasp login`, `clasp create`, `clasp push`, `clasp deploy`, `clasp run`, OAuth flows, or any write/send call against a Google account. `clasp` may be described for a future manual activation, not used now.
- Public documentation/repository browsing for *read-only research* is allowed; no uploading project files or business data to third-party services. Do not change external resources.
- No live mail, even a test email, and no real customer accounts, addresses, attachment contents or credentials. Use synthetic fixtures and service mocks.
- A passing local test suite is **not** proof of Google-hosted integration or production readiness. Label unavailable checks `PENDING LIVE VALIDATION`.

## Workflow: spec-driven-dev
1. Start with `git status --short`, inspect existing files and the installed **spec-driven-dev** skill(s) and their exact instructions. Do not assume skill names, commands or output paths.
2. Read `docs/PRODUCT.md`, `docs/REFERENCE_AUDIT.md`, `docs/REQUIREMENTS_DRAFT.md`, `docs/ACCEPTANCE.md`, `docs/DECISIONS.md` before implementing.
3. Use the installed skill to produce/refine the canonical requirement/design/task artifacts. Keep preliminary source docs as inputs; do not generate duplicate parallel specifications if the skill already provides them.
4. Identify any genuine blocking ambiguity. Choose a documented conservative default for non-blocking matters. Record decisions in the skill's decision artifact or `docs/DECISIONS.md`.
5. Implement in small vertical increments, ideally **test → minimal code → test → review diff → local commit**. Only change tests when requirements changed or the test itself is proven wrong.
6. At each checkpoint: run targeted checks, `git diff --check`, inspect `git diff`, and explain tested vs untested. Keep commits scoped to one behavior or fix.
7. Finish with local commands, test results, acceptance coverage, blocked live checks, remaining risks and a clean/understood `git status`.

## Code and security invariants
- No send without explicit operator selection, validation, review and confirmation. Development remains mock-only.
- A missing/inaccessible attachment, unresolved placeholder, invalid recipient, unauthorized alias or stale changed row **blocks** that email. Never silently omit an expected attachment.
- Respect `Email Address`, `File Attachments`, `Mail Merge Status`, `SKIP`, pre-existing sent statuses and hidden/filtered rows. Only an **empty** status is newly eligible unless a documented explicit human action changes it.
- Re-read/revalidate the selected row at send-time; never rely on an active sheet tab or an old preview alone. Validate recipient and attachment identity before use.
- Use a lock and per-row pre-send checkpoint. A crash between Gmail send and status persistence is **ambiguous**, not safely retryable: mark/leave it for manual review. Do not promise exactly-once or delivery confirmation.
- Escape untrusted values in HTML, sanitize subject/header fields, validate Drive URLs/IDs, minimize OAuth scopes and logs, and never modify sharing permissions.
- Separate deterministic logic from Google service access so the former can be tested offline with Node's built-in test runner and mock adapters. Add dependencies only when necessary and justified.
- No new functionality, speculative abstraction, automated schedule, auto-response, click/open tracking or UI redesign outside the spec.

## Change safety
- Preserve uncommitted work; no destructive `reset`, `clean`, `checkout`, force operations or overwrite. Do not edit files outside the project.
- Keep secrets, local tokens, script IDs and private configuration out of Git. Review `git diff --cached` before each commit.
- The finish line for this assignment is **locally implemented and locally verified**. Deployment, authorizations and live end-to-end acceptance remain explicitly deferred.
