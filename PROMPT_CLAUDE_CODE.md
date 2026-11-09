# Claude Code — initial task (paste into the local project session)

Act as a senior full-stack/field engineer with a bias toward simple, testable internal tools. Build this **small Mail Merge V1 end-to-end LOCALLY** using the `spec-driven-dev` plugin/skills already installed in this Claude Code environment. You own research validation, formal spec/design/tasks, implementation, offline tests, documentation and **local Git commits**. Do not inflate the product.

First read `AGENTS.md`, `CLAUDE.md`, `README.md` and all files in `docs/`. Inspect the actual installed `spec-driven-dev` skills (version, paths, entry points, instructions); use their **real** workflow, not guessed slash commands. Keep one authoritative spec/design/task set in the locations the installed skill expects. Treat `docs/REQUIREMENTS_DRAFT.md` and `docs/ACCEPTANCE.md` as acceptance inputs, not proof that implementation is complete.

Investigate the four public repositories and current vendor documentation identified in `docs/REFERENCE_AUDIT.md` read-only. Compare the code and use only genuinely useful patterns. The core should be Gmail draft templates, Google Sheets, strict Drive attachments, preflight, representative test, explicit confirmation, send-state control and minimal logs. Existing columns/status semantics must be preserved. Use a small native Apps Script V8 codebase; keep deterministic logic offline-testable with minimal mocks. No extra application framework, external service or speculative feature.

**Absolute execution boundary:** local filesystem + local Git only. No remote creation/push/PR, no `clasp login/create/push/deploy/run`, no Google account login, no OAuth, no real sending or any write to an external resource. Do not ask for credentials. Public code/docs may be read-only for research. The final result must be **locally implemented and verified**, with Google-hosted smoke/E2E checks labeled `PENDING LIVE VALIDATION`.

Work in small steps without asking me to approve every implementation detail. Stop only if a decision materially changes intended behavior, scope, permissions or security boundary; choose safe documented defaults otherwise. Do not claim success based on mocks alone. Persist progress in the installed skill's artifacts; preserve Git history and uncommitted files; make small **local** commits after verified increments.

**Acceptance report required:** show real offline test command/output, checked criteria from `docs/ACCEPTANCE.md`, any untested behavior, `git status`, local commits, limitations and exact future manual integration steps. No incomplete/dummy buttons or critical TODOs in production code. Do not spend effort on visual polish unless necessary to use the tool.

Start by checking `git status --short` and identifying the installed skill instructions, then proceed with specs, implementation, tests and local commits within these boundaries.
