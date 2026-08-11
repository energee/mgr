/**
 * Knowledge-graph schema for the mgr codebase.
 *
 * Mirrors the Pydantic schema from Anthropic's knowledge-graph cookbook
 * (Entity / Relation / LlmExtractedGraph), expressed in zod so the same
 * definitions drive both LLM structured output and the deterministic
 * AST/SQL passes.
 *
 * Design notes:
 * - `Predicate` is a CLOSED vocabulary, not a free-text verb phrase. Free
 *   predicates drift ("calls"/"invokes"/"uses" for one edge) and make
 *   multi-hop traversal unreliable. We trade exotic-edge recall for
 *   queryability.
 * - Every relation carries provenance (`file_path`, `extractor`); the commit
 *   is stamped once at the top level of the graph, not per edge, so a rebuild
 *   at a new commit does not rewrite every line of graph.json.
 *   `extractor` lets a query filter to only-precise edges and tells the
 *   eval which pass to blame for a regression.
 * - Field names are chosen to map onto three Postgres tables later
 *   (entities, relations, aliases) with no change to extraction code.
 */
import { z } from "zod";

/** Node kinds. Each is a distinct blast-radius class in this repo. */
export const ENTITY_TYPES = [
  // --- code (from the AST pass; free and exact) ---
  "MODULE", // a source file
  "FUNCTION", // exported function or arrow const
  "COMPONENT", // exported React component
  "ENTITY_CONFIG", // src/entities/<name>/ triad — the repo's spine
  "SERVICE", // src/services/* orchestrator
  "API_ENDPOINT", // src/app/api/**/route.ts x HTTP verb
  "WEBHOOK", // inbound external-event handler
  "TEST",
  // --- database (from the snapshot + migration DDL) ---
  "TABLE",
  "VIEW",
  "DB_FUNCTION",
  "TRIGGER",
  "RLS_POLICY",
  "PERMISSION", // user_has_permission('x:y') strings
  "MIGRATION",
  // --- boundaries and meta ---
  "CONFIG_KEY",      // env var or module constant (SQUARE_WEBHOOK_URL, ...)
  "EXTERNAL_SYSTEM", // Square, QuickBooks, Slack, Mongo, Resend, Sentry
  "JOB", // GitHub workflow or pg_cron schedule
  "QUERY_KEY", // from src/lib/query-keys.ts
  "DOC",
  "FEATURE", // Fxxx from docs/feature_list.json
] as const;

export const EntityType = z.enum(ENTITY_TYPES);
export type EntityType = z.infer<typeof EntityType>;

/** Edge kinds. Closed set — see design note above. */
export const PREDICATES = [
  // structural (AST)
  "imports",
  "calls",
  "defines",
  "tested_by",
  // data access (deterministic: .from()/.rpc()/query-keys)
  "reads_from",
  "writes_to",
  "invokes",
  "invalidates",
  // SQL (deterministic: snapshot + DDL)
  "protects",
  "requires",
  "fires_on",
  "executes",
  "derives_from",
  "creates",
  // boundary / semantic (LLM pass)
  "handles",
  "triggered_by",
  "syncs_with",
  "documented_in",
  "verifies",
] as const;

export const Predicate = z.enum(PREDICATES);
export type Predicate = z.infer<typeof Predicate>;

/** Which pass produced a fact. Lets queries filter to exact-only edges. */
export const Extractor = z.enum(["ast", "sql", "llm"]);
export type Extractor = z.infer<typeof Extractor>;

/**
 * Whether a database object was confirmed against the live catalog snapshot.
 * The snapshot has no VIEW lines, so views can only ever be "chain" —
 * present in the migration chain, unverifiable against live. Query answers
 * surface this rather than implying the same confidence as a live-confirmed
 * table.
 */
export const DbSource = z.enum(["snapshot", "chain"]);
export type DbSource = z.infer<typeof DbSource>;

export const Entity = z.object({
  name: z.string().describe("Canonical identifier, e.g. a table or symbol name"),
  type: EntityType,
  description: z
    .string()
    .describe(
      "One line, grounded in the source file, written to disambiguate this " +
        "entity from same-named ones. This is what the resolver clusters on.",
    ),
  file_path: z.string().describe("Repo-relative path this entity was found in"),
});
export type Entity = z.infer<typeof Entity>;

export const Relation = z.object({
  source: z.string().describe("name of an entity in the same extraction"),
  predicate: Predicate,
  target: z.string().describe("name of an entity in the same extraction"),
});
export type Relation = z.infer<typeof Relation>;

// --- persisted forms (superset of the extraction contract) ---

/** An entity as stored: extraction fields plus resolution/provenance state. */
export type StoredEntity = Entity & {
  aliases: string[];
  extractor: Extractor;
  db_source?: DbSource;
  /** Filled by summarize.ts for hub nodes (degree >= 3). */
  summary?: string;
  key_facts?: string[];
  files?: string[];
};

/** A relation as stored: the triple plus where it came from. */
export type StoredRelation = Relation & {
  file_path: string;
  extractor: Extractor;
};

// --- LLM-facing subset -------------------------------------------------
//
// Benchmarked 2026-08-11 on one 6KB webhook file, identical prompt + schema:
//   gpt-5.3-codex-spark @ low  11s  25 ent / 42 rel  <- fastest and richest
//   gpt-5.6-terra       @ low  15s  12 / 9
//   gpt-5.6-luna        @ low  28s  17 / 23
//   claude -p haiku            65s  ~10, fenced output, no schema enforcement
// Caveat: spark scored best partly by READING THE REPO (codex is agentic under
// -s read-only), not purely by extracting from the prompt text. Pin that down
// in extract.ts rather than assuming the 11s figure extrapolates.
//
// Given the full enum, both gpt-5.6-luna and -terra
// emitted `calls`/`derives_from` edges the AST and SQL passes already produce
// exactly, and misapplied `derives_from` (a VIEW->TABLE predicate) to module
// constants. Restricting the enum the model is allowed to return removes that
// entire failure class at the API boundary.

/** Predicates only the LLM can supply.
 *
 * Measured on an 8-file slice 2026-08-11: given `handles` and `syncs_with`,
 * gpt-5.3-codex-spark pushed ordinary call edges through them — 233 of 262
 * edges were call-graph facts the AST pass already resolves exactly
 * ("syncMalts handles upsertRows"). Restricting the enum stopped wrong TYPES,
 * not wrong SEMANTICS; the model routes around a denied predicate rather than
 * declining to emit the edge. Only these three survived the slice clean. */
export const LLM_PREDICATES = [
  "triggered_by",
  "documented_in",
  "verifies",
] as const;

/** Entity types the LLM may introduce. Database objects are excluded: those
 *  come from the live catalog snapshot, which cannot be hallucinated. MODULE,
 *  SERVICE, JOB and CONFIG_KEY are excluded for the same reason as the dropped
 *  predicates: in the slice they became stand-ins for code symbols the AST pass
 *  already owns (33 sync functions typed JOB, TypeScript types typed MODULE). */
export const LLM_ENTITY_TYPES = [
  "API_ENDPOINT",
  "WEBHOOK",
  "EXTERNAL_SYSTEM",
  "DOC",
  "FEATURE",
] as const;

export const LlmEntity = Entity.extend({ type: z.enum(LLM_ENTITY_TYPES) });
export const LlmRelation = Relation.extend({ predicate: z.enum(LLM_PREDICATES) });
export const LlmExtractedGraph = z.object({
  entities: z.array(LlmEntity),
  relations: z.array(LlmRelation),
});
export type LlmExtractedGraph = z.infer<typeof LlmExtractedGraph>;
