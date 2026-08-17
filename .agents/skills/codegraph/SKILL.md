---
name: codegraph
description: Query the repository knowledge graph in tools/codegraph instead of re-reading files. Use when a question is about relationships - what depends on what, which code touches a table, what a webhook triggers, which RLS policies protect something, or whether a mutation invalidates the cache it writes.
---

Answer the user's question using `tools/codegraph/`, a knowledge graph of this
repository. Prefer it over grepping or reading files when the question is about
*relationships* — what depends on what, what touches a table, what a webhook
triggers, which policies protect something.

## How to use it

```bash
bun tools/codegraph/query.ts "<entity or question>"        # k=2 subgraph as triples
bun tools/codegraph/query.ts --hops 1 "<...>"              # tighter, for hub nodes
bun tools/codegraph/query.ts --exact "src/services/x.ts"   # exact name, no fuzzy match
```

The command prints sorted `(source) --[predicate]--> (target)` triples. Reason over
those directly — do **not** pass `--answer`, which spends a model call to do what
you are already doing.

The graph refreshes itself: `query.ts` compares a content fingerprint of every file
the passes read, and rebuilds the deterministic passes (~7s, offline) if anything
changed -- including uncommitted edits. You do not need to refresh it manually, and
you should not assume it is stale just because commits have landed.

One exception: auto-refresh carries LLM edges over rather than re-running them
(they need a subscription). If a webhook handler or doc changed and you need its
`triggered_by` / `documented_in` edges current, run
`bun tools/codegraph/update.ts --llm`.

## Rules for answering

1. **Ground every claim in a triple, and cite it.** Quote the edges you used.
2. **Never fall back on general knowledge** about Next.js, Supabase, or this repo.
   If the triples do not answer the question, say so and offer to read files.
3. **State what the graph does not contain.** A missing edge means the graph does
   not know — not that the relationship is absent. The LLM pass has deliberately
   low recall.
4. **Check `db_source`.** A node marked `chain` (all views) is present in the
   migration chain but unverified against the live catalog snapshot. Say so.
5. **Check `extractor` when precision matters.** `ast` and `sql` edges are exact by
   construction; `llm` edges are validated but inferred.

## Predicates

| Group | Predicates |
|---|---|
| Structural (AST, exact) | `imports` `calls` `defines` `tested_by` |
| Data access (exact) | `reads_from` `writes_to` `invokes` `invalidates` |
| Database (snapshot + DDL, exact) | `protects` `requires` `fires_on` `executes` `derives_from` `creates` |
| Boundary (LLM, validated) | `triggered_by` `documented_in` `verifies` |
| Tracker (feature_list.json, exact as declared) | `requires` (feature→migration), `documented_in`, `verifies` (test→feature) |

Features (`F###`) are first-class nodes: "what backs F201" or "which features
need this migration" are one-hop queries.

For maintenance sweeps, run `bun tools/codegraph/doctor.ts` — standing checks
for stale-cache, multi-write-without-atomic-RPC, dead DB objects, and untested
write paths, ratcheted against `tools/codegraph/doctor-allowlist.json` (CI runs
`--strict`; findings are leads, not verdicts).

## Worked examples

- *What breaks if I change X?* → seed X, read incoming `imports` / `calls`.
- *Which services touch table Y?* → seed Y, read incoming `reads_from` / `writes_to`.
- *Webhook to side effect?* → seed the endpoint, follow `invokes` to DB functions,
  then `creates` back to the migrations that define them.
- *Cache staleness?* → a module with `writes_to T` but no `invalidates T`.
