# AI-assisted engineering playbook — short, evidence-led

This document distills recurring practices that led to better outcomes in previous small automation projects, then checks them against current vendor guidance. It contains **no proprietary project details**.

## Evidence-based working loop
1. **Inspect first.** Read relevant reference code, commands, git status and current contracts before suggesting a design. Do not redesign working parts without evidence.
2. **Contract first.** Define inputs, output, errors, side effects, ownership of state and acceptance examples; turn ambiguous words such as "works" or "robust" into tests.
3. **Small vertical increments.** Work in a single local repository: spec → test → minimal implementation → review diff → local commit. Avoid big changes that combine behavior, refactor and UI polish.
4. **Demonstrate, don't narrate.** Local success requires actual command outputs and deterministic fixtures. Report unexecuted Google-hosted tests as blocked, not successful.
5. **Local preservation.** Never overwrite uncommitted work, purge files, change remotes or force Git history to make automation convenient.
6. **Separate data and policy.** Prefer configuration for optional values and limits. Never bury account-specific decisions or dynamic quotas in scattered conditionals.
7. **Stop conditions and recovery.** For anything with irreversible external effects, define a checkpoint, failure window and human-reconciliation path. Avoid retrying ambiguous outcomes.
8. **Right-size context.** One short durable `AGENTS.md`, one Claude entry point, small source/requirements docs. No sprawling agent roles or boilerplate. Use subagents only for truly independent, bounded research/review.
9. **Regression before refactor.** If fixing a parser/normalizer or changing a data contract, test the observed failing case plus an adjacent edge case; centralize logic rather than duplicating fixes.
10. **Independent review.** After tests, inspect diff and ask whether changes exceed the spec, whether permissions grew, and what a real user could accidentally trigger.

## Claude Code specifics
- **Instruction files:** `CLAUDE.md` is Claude Code's standard persistent project context. We use `@AGENTS.md` so the main rules are not duplicated. Check recognition with `/memory` or `/context` as supported by the installed version.
- **Skills:** the installed `spec-driven-dev` supplies the procedural framework. Discover its actual files, names, commands and artifacts before invoking it; do not add a second spec tool or guess commands.
- **Plans and tests:** Claude's official advice emphasizes exploring, planning, writing independently verifiable tests and correcting against actual feedback. Treat each acceptance case as the unit of work, not the number of files produced.
- **Permission model:** treat instructions as guidance, not a substitute for technical restrictions. Avoid enabling unconstrained shell/Google access. Require human decisions for external effects; do not bypass prompts/managed settings.
- **Context management:** keep instructions short. Save decisive findings in canonical project files; avoid repeatedly filling agent context with full third-party repositories.
- **Parallelization:** don't split a tiny local Apps Script feature across many agents. Parallel read-only review might help; implementation on shared files should be sequential and auditable.

## Suggested local quality gates
- Tests: deterministic unit tests plus mocked side-effect integration tests with explicit zero-send assertions.
- Static: syntax checks, optional ESLint only if its maintenance cost is justified, `git diff --check`.
- Change review: inspect tracked secrets, OAuth scopes, dependencies, runtime send path and no-op UI controls.
- Scope review: check that nothing introduced scheduling, public Drive sharing, tracking or a standalone frontend.
- Handoff: record command outputs, counts of PASS/FAIL/BLOCKED, local commit IDs and next live validation step.

## Primary public sources (verified 2026-11-08)
- Anthropic / Claude Code best practices: https://code.claude.com/docs/en/best-practices
- Anthropic / instruction files and AGENTS.md: https://code.claude.com/docs/en/memory
- Anthropic / skills vs rules/subagents/hooks: https://claude.com/resources/articles/steering-claude-code-skills-hooks-rules-subagents-and-more
- Google / Apps Script CLI: https://developers.google.com/apps-script/guides/clasp
- Google / Apps Script quotas: https://developers.google.com/apps-script/guides/services/quotas

Vendor guidance is a source for methods, not proof that this project's code has been tested. The locally installed skill's actual instructions take precedence over our assumptions about its command syntax.
