@AGENTS.md

# Claude Code entry point

- Read `PROMPT_CLAUDE_CODE.md` and the product/spec documents before changing code.
- The user has installed `spec-driven-dev` through Claude Code. Inspect the **actual installed skill** (name, version, procedures and artifacts) and follow it; do not invent slash commands or impose an unrelated spec framework.
- Use the skill to converge on one canonical spec/design/tasks set, then implement the **locally testable** V1 in the same local repository.
- Make progress autonomously within the scope and local Git boundary. Escalate only a decision that changes the promised behavior, security contract or external-access boundary.
- Do not create extra agents, hooks, commands, dashboards or architectural layers unless a concrete verified need justifies them.
