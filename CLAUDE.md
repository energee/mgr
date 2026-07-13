# mgr — Claude Code entry point

All project instructions live in `AGENTS.md`, shared with Grok, Codex, and any other harness. Do not add project rules here — add them there.

@AGENTS.md

## Claude Code specifics

These apply only when running under Claude Code (or a harness that mirrors its tool names). Shared process is in [`docs/agents/process.md`](docs/agents/process.md).

- **Expert agents** (`.claude/agents/*.md`, table in `AGENTS.md`): dispatch them as subagents rather than reading them inline. When work fans out across independent files/tests, dispatch expert agents in parallel.
- **Search**: prefer `mgrep` for semantic code/web search when that skill is available; use exact `Grep`/`rg` only for ref-counting or literal matches.
- **Minor choices** (naming, defaults, equivalent approaches): pick one and note it — don't ask. Ask only for scope changes or destructive actions.
- **Hooks / permissions**: `.claude/settings.json` (and local overrides) — harness-only; not shared instruction content.
