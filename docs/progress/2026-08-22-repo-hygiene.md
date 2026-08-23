- **2026-08-22 (repo hygiene: 150 GB of scratch, stale worktrees, knip config rot).**
  The checkout had grown to **153 GB**, of which ~25 MB was tracked content.
  `.autoharness/` alone held **121 GB**: every run of the `src/lib` screening loop
  serializes a full recursive file manifest into its JSON records
  (`iter_0031/summary.json` = 829 MB / 16.6 M lines / 3,327,904 `{path, size}`
  pairs), unscoped to the configured editable surface and not honoring
  `.gitignore` — it walks `.claude/`, `.pnpm-store/`, `.next/`, `.git/` and
  `.autoharness/` itself, so each run snapshots the prior runs' records and the
  growth compounds. Stored ~4x per iteration across `summary.json`,
  `execution_manifest.json`, `tracks/main/registry/` and `tracks/main/proposals/`.
  The bug is upstream (`~/.local/bin/autoharness`, not this repo); filed as #943.
  Deleted `.autoharness/` (121 GB), `.next/` (27 GB), `.pnpm-store/` (984 MB —
  the repo uses bun) and stopped a `next dev` server idle since 2026-08-12.
  Also removed 15 merged worktrees (35 GB → 0) and 100 local branches, each
  verified content-identical to `main` before deletion; `git gc` took `.git`
  from 43 MB to 11 MB. **153 GB → 2.7 GB.** Kept `docs/phase-4-rebaselined-plan`,
  the one branch with unique content not in main.
  Code-side, the 2026-07-24 ponytail audit is fully worked through (all 45 items
  dispositioned), and its two un-hunted areas turned out moot: `src/components/rest`
  does not exist, and every `scripts/` entry is referenced. A fresh knip pass
  surfaced only config rot: three `entry` patterns Next.js auto-detects, an
  `ignoreUnresolved` for `jsr:@supabase/.*` that no longer matched (knip reported
  `jsr` as an unlisted dependency instead — now an `ignoreDependencies` entry),
  and an unused `yaml` devDependency. Knip's remaining 134 export / 73 type
  findings are the known false-positive classes AGENTS.md rule 17 describes
  (shadcn re-exports, `z.infer` types, entity-registry indirection).
