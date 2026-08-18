# codegraph — a queryable knowledge graph of this repository

Answers multi-hop questions with edge-level citations: *what breaks if I change X*,
*which services touch table Y*, *what is the full path from webhook receipt to
side effect Z*.

Built on the structure of [Anthropic's knowledge-graph cookbook](https://github.com/anthropics/anthropic-cookbook)
(extract → resolve → summarize → query), but with the division of labour inverted
where this repo makes that possible: **~99% of the graph is produced by parsers, not
by a model.**

## Quick start

```bash
bun tools/codegraph/build.ts                     # full deterministic build, ~7s, offline
bun tools/codegraph/query.ts "batches"           # k=2 subgraph as triples
bun tools/codegraph/query.ts --answer "which policies protect batches"
```

`graph.json` is committed, so querying works from a clean clone with no build step.

## Staying fresh

`query.ts` rebuilds the graph automatically when it is stale, so you never query
stale data and never have to remember to refresh. Pass `--no-refresh` to opt out.

Staleness is decided by a **content fingerprint of the input set**, not by comparing
commit hashes. Hash comparison is wrong in both directions: it fires on every commit
including ones touching files the graph never reads (`docs/progress/`, CI config), so
the warning becomes noise; and it reports "fresh" for uncommitted working-tree edits,
which is the most common way a graph goes wrong mid-session. The fingerprint takes
tracked blob SHAs straight from git's index (no file reads) and overlays anything git
reports as modified, so it survives 50 unrelated commits and goes stale the moment you
edit a source file. The digest also folds in an `EXTRACTOR_VERSION` constant
(`store.ts`), bumped whenever the extractor code itself changes what it emits — so a
parser change invalidates old graphs even though `tools/codegraph/` is not an input.

Auto-refresh runs the deterministic passes only (~7s, offline). LLM edges are carried
over from the existing graph rather than re-run, since those need a subscription --
refresh them explicitly with `bun tools/codegraph/update.ts --llm`.

## Commands

| Command | Does | Cost |
|---|---|---|
| `build.ts` | Full deterministic build (AST + SQL) | ~7s, $0, offline |
| `update.ts [ref] [--llm]` | Incremental update since a ref | ~7s + changed LLM files |
| `query.ts <q> [--hops N] [--answer] [--exact]` | Serialize a subgraph; optionally answer | instant / one model call |
| `summarize.ts [--degree N] [--dry-run]` | Profile domain hub nodes | ~11s per hub |
| `eval.ts [--sql\|--llm]` | Score extractors against gold sets | one model call per LLM case |
| `doctor.ts [--strict\|--baseline]` | Standing maintenance checks (see below) | instant, $0 |

## How it is built

Three passes, merged and resolved, persisted as NetworkX node-link JSON.

**1. AST pass (`ast.ts`) — free, exact.** Uses the repo's own TypeScript compiler,
so imports and call targets are *resolved*, not name-matched. Also reads Supabase
`.from()` / `.rpc()` chains and `dynamicRpc(client, "fn")` wrappers for
`reads_from` / `writes_to` / `invokes`, and `entityKeys("table")` for `invalidates`
— which makes *"writes a table but never invalidates its cache"* a single query.

**2. SQL pass (`sql.ts`) — free, exact.** `supabase/live-catalog.snapshot.txt` is
authoritative for tables, policies, triggers and functions: those cannot be
hallucinated because they are observed live. Migrations supply edges only.
Views are the exception — the snapshot has no VIEW lines, yet 20 of the 88
relations the app queries are views, so views come from the migration chain and
are tagged `db_source: "chain"` to mark them snapshot-unverified.

**3. Tracker pass (`features.ts`) — free, declared.** `docs/feature_list.json`
is machine-readable and gate-enforced (`make check-deploy-state`), so FEATURE
edges are parsed, not inferred: `requires` to each declared migration,
`documented_in` to docs named in evidence, `verifies` from test files named in
the verification command (directories expand; only paths that exist on disk
count). Tagged `extractor: "tracker"`.

**4. LLM pass (`extract.ts`) — narrow, validated.** Runs `gpt-5.3-codex-spark`
via `codex exec` (ChatGPT subscription; no API key on this machine) with
`--output-schema` enforcing the shape server-side. It may emit only
`triggered_by` / `documented_in` / `verifies` and only boundary entity types.
Results cache by content hash.

## Doctor: the graph asking its own questions

`doctor.ts` codifies defect classes this repo has actually shipped as standing
queries: **stale-cache** (client module writes a table, invalidates no query
key), **multi-write** (2+ tables written in one file with no atomic RPC —
issue #822's class), **dead-db** (live object no app code touches), and
**untested-writes**. Findings ratchet against `doctor-allowlist.json`:
`--baseline` grandfathers today's state, CI (`Static Checks`) runs `--strict`
against a fresh rebuild so new findings fail the PR that introduces them, and
allowlist entries are deleted as they are cleaned up. Findings are leads, not
verdicts — e.g. a DB function used only inside RLS policy expressions has no
incoming graph edge and reads as dead (the graph has no policy→function
edges).

## Staying fresh, part 2: the committed artifact

Local consumers always get a fresh graph (auto-refresh above), but the
COMMITTED `graph.json` used to drift for weeks (#796).
`.github/workflows/codegraph-refresh.yml` now rebuilds the deterministic
passes on every push to main that touches an input and lands the diff through
an auto-merged bot PR, mirroring `progress.yml`.

## Why the LLM does so little

Measured, not assumed. Given a wider schema the model does not decline to answer
— it *reroutes*:

| Round | Result |
|---|---|
| Full predicate set | 262 relations from 8 files, 233 of them call edges wearing `handles` (`syncMalts handles upsertRows`) |
| Dropped `handles`/`syncs_with` | 13 relations — but `DOC` now held functions, `FEATURE` held modules, and every `triggered_by` was reversed |
| Validate in code | 4 relations, all correct |

So each edge is checked against a legal `(domain, range)` pair; reversed edges are
flipped, unsalvageable ones dropped. A `DOC` name must end `.md`, a `FEATURE` must
match `F\d{3}`, or the entity is discarded — otherwise both become generic buckets
for code symbols the AST pass already owns.

Recall is deliberately low. A wrong edge propagates through every multi-hop answer
that crosses it; a missing edge only costs a question.

## Why resolution is rules, not a model

The cookbook clusters surface-form variants with an LLM because its entities come
from prose. Measured here: **zero within-type name collisions across 3,892
entities.** The parsers mint canonical names by construction — repo-relative paths,
snapshot table names, policies qualified `table.policy`. `resolve.ts` normalizes
the two places variants genuinely arise (DOC paths, EXTERNAL_SYSTEM casing) and
reports both cookbook failure modes: untouched entities, and merges differing by
more than case.

Policy and trigger names are qualified `table.name` because they are unique *per
table*, not globally — `current_user_enabled` alone exists on 107 tables, and an
unqualified key silently collapsed 106 of them.

## Grounding

`query.ts` prints triples and nothing else by default; inside Claude Code the
harness already has a model, so it reasons over them for free. With `--answer` the
prompt forbids general knowledge, requires citing the edges used, and requires
stating what the graph does **not** contain. A missing edge means the graph does
not know — never that the relationship is absent.

## Eval

`eval/gold.json` holds hand-written gold sets, one per extractor, so an F1 drop
points at which pass regressed. Scoring is by **provenance**: every fact records
the file it came from, so "what this file contributes" is exact rather than a
topology heuristic. Two cases deliberately specify a nearly-empty answer — they
exist to catch over-extraction, not misses.

## Storage

NetworkX node-link JSON (`networkx.node_link_graph()` reads it unchanged). Every
edge carries `file_path` and `extractor` (`ast` | `sql` | `llm`), so a query can
filter to parser-only edges; the commit is stamped once at the top level rather
than per edge, so a rebuild at a new commit does not rewrite all ~8,400 lines of
the committed `graph.json` (which made every parallel branch a merge conflict). The shape maps 1:1 onto three Postgres
tables — `entities`, `relations`, `aliases` — and moving off JSON touches only
`store.ts`.

## Known gaps

- Views are chain-only (`db_source: "chain"`), never snapshot-confirmed.
- An earlier draft here claimed application code queries a stale `brews` relation.
  Investigated 2026-08-11 and unreproducible: the only `.from("brews")` in the
  repo's entire history is synthetic code inside a template-literal fixture in
  `src/services/__tests__/transition-call-sites.test.ts` (invisible to the AST
  pass, which walks call expressions, not string contents), and no committed
  `graph.json` has ever contained a `brews` node or edge.
- `avatars` (storage bucket) and `fixture` (test artifact) are correctly absent.
- The LLM pass has low recall by design; absence of an edge is not evidence of absence.
