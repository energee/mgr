# Observability

Three layers of visibility, each with a different audience and time scale.

| Layer | Captures | Lives in | Read by |
|---|---|---|---|
| **Runtime errors / traces** | Production exceptions, slow requests | [Sentry](https://sentry.io) | On-call human + Sentry harness |
| **Agent task traces** | Per-session decision trail | `.harness/sessions/<date>-<slug>.md` | The next agent picking up work |
| **Quality snapshot** | Domain / layer health (A–D) | [`docs/agents/quality.md`](quality.md) | Weekly review, trend tracking |

## Layer 1 — Sentry (runtime)

Sentry is wired in via `@sentry/nextjs`:

- `sentry.server.config.ts` — Node runtime
- `sentry.edge.config.ts` — edge runtime
- `src/lib/sentry-config.ts` — shared base config

**To enable locally**: set `NEXT_PUBLIC_SENTRY_DSN` in `.env`. Without the DSN, Sentry is a no-op — safe for dev.

**The Sentry Error Harness** (`.github/workflows/sentry-error-harness.yml`) is an autonomous fix loop that runs twice a day, scores open issues, and opens fix PRs. See [`docs/sentry-harness-setup.md`](../sentry-harness-setup.md) for first-run setup. Required GitHub secrets: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`.

**When investigating a production error**:

1. Pull up the Sentry issue. Note the `shortId`, `eventCount7d`, and stack trace.
2. If it's been triaged by the harness, find the `sentry-fix/SENTRY-<id>` branch and PR.
3. Otherwise: trace the stack to source files, follow the bug-fix process in [`debugging.md`](debugging.md).

## Layer 2 — Agent task traces

Per-session decision trail. Captures **what the agent did and why**, not the data.

**Convention**: one markdown file per session at `.harness/sessions/<YYYY-MM-DD>-<short-slug>.md`. The slug should match the feature ID being worked on (e.g., `2026-05-02-F003-feature-list.md`).

**Template**:

```markdown
# Session: <feature ID> — <title>

- Started: <ISO timestamp>
- Branch: <branch>
- Starting commit: <sha>

## Plan
<one paragraph; what the agent set out to do>

## Decisions
- <timestamp> — <choice> — <reason>
- <timestamp> — <choice> — <reason>

## Verification log
- `make check` ran at <timestamp> — <result>
- `make verify-feature ID=Fxxx` ran at <timestamp> — <result>

## Outcome
- Ending commit: <sha>
- Feature state: <not_started | in_progress | blocked | passing>
- Followups: <list>
```

**When to update**: any decision that an unfamiliar reviewer would later ask "why did you do this?" about. Skip routine line edits.

**Privacy**: traces are committed alongside code, so don't paste secrets, customer data, or full database rows.

## Layer 3 — Quality snapshot

[`docs/agents/quality.md`](quality.md) — A–D grades per domain (production / inventory / sales / purchasing / catalog) and per architectural layer (entity configs / universal components / DB / queries / UI / AI). Updated weekly or whenever a major change shifts a grade.

**Use it to**:

- Spot weak areas before starting a session ("UI in catalog is C — extra care here").
- Detect whether harness changes improve project health (compare snapshots).
- Justify the next refactor target.

It is **not** a metric anyone is graded on. It's a forecast.
