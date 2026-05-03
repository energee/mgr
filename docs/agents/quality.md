# Quality snapshot

Codebase health at a glance. Grade each domain and architectural layer A–D.
Update weekly, or whenever a major change shifts a grade. Compare against
previous snapshots in `git log -- docs/agents/quality.md`.

## Grades

- **A** — solid; would not be the bottleneck if a competent agent took over today.
- **B** — works; a minor refactor would clean it up.
- **C** — surfaces issues regularly (bugs, agent confusion, slow iteration). Plan a focused session.
- **D** — actively painful; consider a corrective rewrite.

## Domains

| Domain | Grade | As of | Notes |
|---|---|---|---|
| production | _TBD_ | 2026-05-02 | _initial baseline pending_ |
| inventory  | _TBD_ | 2026-05-02 | _initial baseline pending_ |
| sales      | _TBD_ | 2026-05-02 | _initial baseline pending_ |
| purchasing | _TBD_ | 2026-05-02 | _initial baseline pending_ |
| catalog    | _TBD_ | 2026-05-02 | _initial baseline pending_ |
| packaging  | _TBD_ | 2026-05-02 | _initial baseline pending_ |
| auth       | _TBD_ | 2026-05-02 | _initial baseline pending_ |
| ai         | _TBD_ | 2026-05-02 | _initial baseline pending_ |

## Architectural layers

| Layer | Grade | As of | Notes |
|---|---|---|---|
| Entity configs (`src/entities/`)              | _TBD_ | 2026-05-02 | _initial baseline pending_ |
| Universal components (`src/components/universal/`) | _TBD_ | 2026-05-02 | EntityDetail / EntityForm still in repo (deprecated) |
| Domain components (`src/components/domain/`)  | _TBD_ | 2026-05-02 | _initial baseline pending_ |
| Hooks (`src/hooks/`, `src/lib/queries/`)      | _TBD_ | 2026-05-02 | _initial baseline pending_ |
| DB schema (`supabase/migrations/`)            | B     | 2026-05-02 | Three security checks now executable; legacy auth.users patterns documented; one corrective migration pending apply (00156). |
| Tests (vitest + Playwright)                   | _TBD_ | 2026-05-02 | _initial baseline pending_ |
| AI integration (`src/lib/ai/`, DB functions)  | _TBD_ | 2026-05-02 | _initial baseline pending_ |
| Harness (this folder + `Makefile`)            | A-    | 2026-05-02 | New as of 2026-05-02; not yet battle-tested across multiple sessions. |

## Trend log

> Append a one-liner whenever a grade moves. Don't edit prior entries.

- **2026-05-02** — Harness rolled out (A-). DB schema bumped from C to B because executable security checks now exist, even though the corrective migration 00156 still needs to be applied.
