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

If the graph looks stale, refresh it: `bun tools/codegraph/update.ts` (~7s, offline).

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

## Worked examples

- *What breaks if I change X?* → seed X, read incoming `imports` / `calls`.
- *Which services touch table Y?* → seed Y, read incoming `reads_from` / `writes_to`.
- *Webhook to side effect?* → seed the endpoint, follow `invokes` to DB functions,
  then `creates` back to the migrations that define them.
- *Cache staleness?* → a module with `writes_to T` but no `invalidates T`.
