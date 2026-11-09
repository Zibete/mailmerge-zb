# Local Mail Merge — spec-driven development starter

**Status:** research + draft requirements. **Not implemented, not deployed, no emails sent.** This package is the local starting point for Claude Code and its installed `spec-driven-dev` skill.

## Goal
Reproduce a small, familiar mail merge workflow using Google Sheets, Gmail drafts and Drive attachments, without a paid add-on or unrelated features. The entire development lifecycle and Git repository remain **local**. Google-hosted execution is a separate, later approval step.

## Local startup (Windows / PowerShell)
1. Extract this package into a new folder on your computer (for example `Documents\MailMergeLocal`).
2. In that folder, open PowerShell or Claude Code's terminal and run:

   ```powershell
   git init
   git status --short
   claude
   ```

3. In Claude Code, paste the text from `PROMPT_CLAUDE_CODE.md` (or ask it to read that file). It must discover the **installed** `spec-driven-dev` procedures, write/refine its required artifacts, implement locally and run offline tests.
4. Claude may make **local** commits; it must not create a remote or call any Google write/send or deployment API.

Do not run `clasp login`, `clasp push`, `clasp create`, or configure live Google credentials during this assignment. `clasp` is a **future deployment tool**; it does not replace Git and it does not make Apps Script's services run locally.

## Ejecutar las pruebas (Node.js portable)
Node.js no está instalado en el sistema; se usa la copia portable `C:\Users\matias.peralta_exter\nodejs\node-v20.11.1-win-x64` (v20.11.1). El PATH se modifica solo para la sesión de terminal actual, nunca en forma permanente. Desde la raíz del proyecto:

```powershell
$env:Path = "C:\Users\matias.peralta_exter\nodejs\node-v20.11.1-win-x64;$env:Path"
node --version   # debe mostrar v20.11.1
node --test      # ejecuta todos los *.test.js, sin red ni credenciales de Google
```

En Git Bash: `export PATH="/c/Users/matias.peralta_exter/nodejs/node-v20.11.1-win-x64:$PATH"` y luego `node --test`. El proyecto no tiene dependencias: no hace falta `npm install`.

## Guías de operación y estado de aceptación
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md): uso del menú `Mail Merge`, estados, reconciliación manual, límites configurables, checklist `PENDING LIVE VALIDATION` y activación futura (no ejecutada).
- [`docs/ACCEPTANCE_STATUS.md`](docs/ACCEPTANCE_STATUS.md): estado de cada criterio AC-01 a AC-31, tests que lo cubren y verificaciones en vivo pendientes. Nivel alcanzado: `LOCAL_VERIFIED`.

## Reading order
1. `AGENTS.md` — durable engineering contract.
2. `CLAUDE.md` — Claude Code import/entry point.
3. `docs/PRODUCT.md` — user workflow, limits and intended result.
4. `docs/REFERENCE_AUDIT.md` — code research and defects not to replicate.
5. `docs/REQUIREMENTS_DRAFT.md` — initial functional contract for the installed skill to formalize.
6. `docs/ACCEPTANCE.md` — executable acceptance criteria.
7. `docs/DECISIONS.md` — resolved vs deferred choices.
8. `docs/ENGINEERING_PLAYBOOK.md` — AI-assisted engineering and local verification.
9. `PROMPT_CLAUDE_CODE.md` — initial handoff prompt.

## Explicit completion levels
- **Local complete:** implementation present, offline unit/integration tests passing, fixtures and docs included, local commits recorded, no remote or real-account operations.
- **Live verified:** intentionally **not part of this assignment**; requires future human authorization, Google Apps Script setup, isolated test sheet/account and explicit live tests.

This pack contains no third-party source code and no real business data. Review third-party licenses before copying any code in a future iteration.
