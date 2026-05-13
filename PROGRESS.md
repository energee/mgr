# Progress

> **Single source of truth** for what's done, what's in flight, and what's next.
> Read at session start. Update at session end.

## Current state

- **Reflects**: `main` at `9eeb3da` (feat(bom): whole-unit math and intuitive BOM/receive UX, #254) — 2026-05-12
- **Last verified**: 2026-05-04 (see `docs/agents/quality.md` trend log)
  - `make check-fast` — clean (lint + typecheck)
  - `make check-db` — all 8 checks green (security_invoker / RLS / auth.users / search_path / SECURITY DEFINER / permissive RLS / schema_registry / data-model docs)
  - `bun run test` — 1019 / 1019 pass
  - `BOOTSTRAP_SKIP=0 bash scripts/init.sh` — all 4 contract conditions PASS
  - `make check` end-to-end cannot run inside the agent sandbox (Turbopack port binding); verified piecewise

## In progress

_(none known)_

## Deferred

Open work that's logged but not currently being executed. Pull from this list when picking up new work.

- **`notify_all_users` SECURITY DEFINER refactor** — function still reads from `auth.users` (defined in `00090_slack_integration.sql:117`; callers in `00070`, `00145`, `00148`). Whitelisted via `check-auth-users-leak` skip comments. Should move to `user_profiles`. Low priority.
- **Pick list — no bin-level detail** — `pick_list_items` lacks `bin_id`; UI shows only location name. Legacy `OrderPickList` displays bin + location, which matters for warehouse travel. Needs migration + `generate_pick_list` update + UI change. See `docs/plans/deferred-gaps.md`.
- **Pick list — no location-based sort** — items sorted by `sort_order` (generation order). Should sort `location_name → bin_name → lot_number`. See `docs/plans/deferred-gaps.md`.
- **Hardcoded 7-day PO lead time** — `src/lib/purchasing/po-generator.ts:215` uses `+ 7`; should use `Math.max(...leadTimes)` from shortfall data. See `docs/plans/deferred-gaps.md`.
- **Normalize `containers.volume_oz`** — heuristic disambiguation in `src/hooks/use-catalog.ts:100` (per-unit vs rolled-up case totals). Should be normalized at the schema level so the heuristic can be dropped.
- **Deeper E2E flows** — `test.skip` in `e2e/{batch-transfer, customer-order, dashboard, production-workflow, recipe-editor, packaging-session}.spec.ts` pending seed data. Smoke routes pass; F114/F128/F134/F135/F136 are marked `passing` on that basis.
- **Tighten DB allowlists** — `~30` grandfathered entries across permissive-RLS / SECURITY DEFINER / search_path / data-model docs allowlists. Tighten over time.
- **Raise `src/lib/**` coverage threshold** — currently 50% in `vitest.config.ts`; raise gradually as coverage improves.
- **Harness soak** — promote `Harness` layer grade A− → A after a 2-week multi-session soak proves drift detection works in practice (target: 2026-05-18).

## Recent history

- **2026-05-12** — #254 BOM whole-unit math + intuitive BOM/receive UX
- **2026-05-04..** — Sentry-harness hardening: #257 grants Claude Code the required toolset; #256 streams Claude Code Action output to job log; #255 reads org/project from `vars` to avoid output redaction
- **2026-05-04** — Migration `00156_security_invoker_corrections` applied to production via `bun run db:migrate -- --include-all` (9 legacy views + `recent_vessel_cleanings` rebuild now live)
- **2026-05-04** — `docs/agents/quality.md` baselines filled (no remaining `_TBD_` cells); F200 dashboard activity heatmap marked passing (#252); redundant Vercel deploy workflow removed (#253)
- **2026-05-03** — #251 autoharness screening + Claude OAuth shim; #250 `src/lib` dead-code removal + dedup
- **2026-05-02..03** — Walkinglabs harness rollout (#249, merged): `Makefile` with layered gates, `AGENTS.md` router + topic docs, `feature_list.json` (48 features), 8 executable DB checks, ESLint custom rules (DEC-008 / centralized query keys / `EntityDetail` re-introduction block), WIP=1 enforcement, bootstrap contract validation, Sentry harness writes harness state, coverage thresholds, migration dry-run

## Known issues

- `make` warnings about `xcrun_db` permission errors only appear inside Claude Code's sandbox; normal terminals don't show them.
- `make check` cannot be exercised end-to-end inside the agent sandbox because Turbopack `next build` requires port binding. Verified piecewise: `make check-fast`, `bun run test`, `make check-db`.

## Next steps

Pick from **Deferred** based on priority. No active in-flight work.
