/**
 * Extraction eval.
 *
 *   bun tools/codegraph/eval.ts            # score every gold case
 *   bun tools/codegraph/eval.ts --sql      # score one extractor
 *
 * Gold sets live in eval/gold.json, one case per extractor, so a drop in F1
 * points at which pass regressed rather than at a blended number. Entities are
 * matched on name+type, relations on source+predicate+target.
 *
 * The scorer is scoped by PROVENANCE: every fact records the file it was read
 * from, so "what this file contributes" is exact rather than a topology
 * heuristic. This has a real consequence for SQL - a policy's `protects` edge
 * is attributed to the live-catalog snapshot, which is authoritative for
 * policy->table, so it is not scored against the migration that declared the
 * policy. The migration is scored on its own node and its `creates` edges.
 *
 * Precision matters more than recall here, and the gold sets are written that
 * way: two of the four cases deliberately specify a nearly-empty answer, to
 * catch a pass that invents structure rather than one that misses it.
 */
/* eslint-disable no-console -- CLI entry point: stdout is the output. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runSqlPass } from "./sql";
import { runAstPass } from "./ast";
import { runLlmPass } from "./extract";
import type { StoredEntity, StoredRelation } from "./schema";

type GoldEntity = { name: string; type: string };
type GoldRelation = { source: string; predicate: string; target: string };
type GoldCase = {
  file: string;
  extractor: "sql" | "llm" | "ast";
  why?: string;
  entities: GoldEntity[];
  relations: GoldRelation[];
  notes?: string[];
};

const eKey = (e: { name: string; type: string }) => `${e.type}|${e.name}`;
const rKey = (r: { source: string; predicate: string; target: string }) =>
  `${r.source}|${r.predicate}|${r.target}`;

type Score = {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  missing: string[];
  spurious: string[];
};

function score(predicted: string[], gold: string[]): Score {
  const p = new Set(predicted);
  const g = new Set(gold);
  const missing = [...g].filter((k) => !p.has(k)).sort();
  const spurious = [...p].filter((k) => !g.has(k)).sort();
  const tp = g.size - missing.length;
  // An empty gold set with an empty prediction is a perfect score, not 0/0.
  const precision = p.size === 0 ? (g.size === 0 ? 1 : 0) : tp / p.size;
  const recall = g.size === 0 ? 1 : tp / g.size;
  const f1 =
    precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    tp,
    fp: spurious.length,
    fn: missing.length,
    precision,
    recall,
    f1,
    missing,
    spurious,
  };
}

const pct = (n: number) => `${(n * 100).toFixed(0).padStart(3)}%`;

// Each deterministic pass runs once per eval regardless of case count (the
// AST pass is a full ~7s TS program compile).
const passCache = new Map<string, { entities: StoredEntity[]; relations: StoredRelation[] }>();
const passFor = (root: string, extractor: "sql" | "ast") => {
  const cached = passCache.get(extractor);
  if (cached) return cached;
  const out = extractor === "sql" ? runSqlPass(root) : runAstPass(root);
  passCache.set(extractor, out);
  return out;
};

async function predictFor(
  root: string,
  c: GoldCase,
): Promise<{ entities: StoredEntity[]; relations: StoredRelation[] }> {
  if (c.extractor === "llm") {
    // Hold the eval to the same anti-fabrication gate production uses: without
    // knownEndpoints, entityShapeOk falls back to a shape regex and the eval
    // scores a laxer validator than the one that builds the graph.
    const knownEndpoints = new Set(
      passFor(root, "ast")
        .entities.filter((e) => e.type === "API_ENDPOINT" || e.type === "WEBHOOK")
        .map((e) => e.name),
    );
    return runLlmPass(root, { files: [c.file], knownEndpoints });
  }
  // Scope by PROVENANCE, not topology. Every fact carries the file it was
  // read from, and that is precisely "what this file contributes" - so the
  // eval scores exactly that. Two earlier attempts got this wrong: filtering
  // relations by file while keeping topologically-reached entities scored
  // false misses, and expanding one hop dragged in everything adjacent to a
  // hub table and destroyed precision.
  //
  // Consequence, and it is correct: a policy's `protects` edge belongs to the
  // live-catalog snapshot (authoritative for policy->table), NOT to the
  // migration that declared the policy. The migration contributes its own
  // node and its `creates` edges. The gold set says exactly that.
  const all = passFor(root, c.extractor);
  return {
    entities: all.entities.filter((e) => e.file_path === c.file),
    relations: all.relations.filter((r) => r.file_path === c.file),
  };
}

async function main(): Promise<void> {
  const root = process.cwd();
  const argv = process.argv.slice(2);
  const only = argv.find((a) => a.startsWith("--"))?.replace("--", "");

  const gold = JSON.parse(
    readFileSync(join(root, "tools/codegraph/eval/gold.json"), "utf8"),
  ) as { cases: GoldCase[] };

  const cases = only ? gold.cases.filter((c) => c.extractor === only) : gold.cases;
  // A gate that scores nothing must not pass: a typo'd flag ("--asy") or a
  // renamed extractor field would otherwise print "0 case(s)" and exit 0.
  if (cases.length === 0) {
    console.error(
      only
        ? `no gold cases for extractor "${only}" - known: ${[...new Set(gold.cases.map((c) => c.extractor))].join(", ")}`
        : "gold.json contains no cases",
    );
    process.exit(2);
  }
  const rows: { label: string; ent: Score; rel: Score }[] = [];

  for (const c of cases) {
    const got = await predictFor(root, c);
    const ent = score(got.entities.map(eKey), c.entities.map(eKey));
    const rel = score(got.relations.map(rKey), c.relations.map(rKey));
    rows.push({ label: `${c.extractor}: ${c.file}`, ent, rel });

    console.log(`\n=== ${c.file}  [${c.extractor}] ===`);
    if (c.why) console.log(`    ${c.why}`);
    console.log(
      `  entities  P ${pct(ent.precision)}  R ${pct(ent.recall)}  F1 ${pct(ent.f1)}   ` +
        `(tp ${ent.tp}, fp ${ent.fp}, fn ${ent.fn})`,
    );
    console.log(
      `  relations P ${pct(rel.precision)}  R ${pct(rel.recall)}  F1 ${pct(rel.f1)}   ` +
        `(tp ${rel.tp}, fp ${rel.fp}, fn ${rel.fn})`,
    );
    for (const m of ent.missing) console.log(`    MISSING entity    ${m}`);
    for (const s of ent.spurious) console.log(`    SPURIOUS entity   ${s}`);
    for (const m of rel.missing) console.log(`    MISSING relation  ${m}`);
    for (const s of rel.spurious) console.log(`    SPURIOUS relation ${s}`);
  }

  const mean = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  console.log(`\n=== macro average over ${rows.length} case(s) ===`);
  console.log(`  entity   F1 ${pct(mean(rows.map((r) => r.ent.f1)))}`);
  console.log(`  relation F1 ${pct(mean(rows.map((r) => r.rel.f1)))}`);

  // The gold sets are exact specifications and score 100% by construction, so
  // ANY drop is a regression - gating only on f1 === 0 let an 80% edge loss
  // ride through green.
  const broken = rows.filter((r) => r.ent.f1 < 1 || r.rel.f1 < 1);
  if (broken.length) {
    console.error(
      `\n${broken.length} case(s) scored below 100%: ${broken.map((b) => b.label).join(", ")}`,
    );
    process.exit(1);
  }
}

if (import.meta.main) await main();
