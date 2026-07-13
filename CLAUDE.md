# mgr — Claude Code entry point

All project instructions live in `AGENTS.md`, shared with Codex and any other harness. Do not add rules here — add them there.

@AGENTS.md

## Claude Code specifics

- Expert agents (`.claude/agents/*.md`, table in `AGENTS.md`): dispatch them as subagents rather than reading them inline. When work fans out across independent files/tests, dispatch them in parallel.
- Search: `mgrep` to locate code by meaning; the literal `Grep`/`rg` tools only for exact-string ref-counting.
- Minor choices (naming, defaults, equivalent approaches): pick one and note it — don't ask. Ask only for scope changes or destructive actions.
