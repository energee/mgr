/**
 * LLM extraction pass.
 *
 * Runs only on files no parser can interpret, and is allowed to emit only the
 * predicates and entity types no parser can produce (LLM_PREDICATES /
 * LLM_ENTITY_TYPES in schema.ts). The AST and SQL passes own every structural
 * and data-access edge exactly, so letting the model restate them would add
 * competing, occasionally-wrong duplicates.
 *
 * Transport is `codex exec` rather than an HTTP API: it authenticates against
 * the ChatGPT subscription already on this machine (no ANTHROPIC_API_KEY is
 * present here), and its --output-schema flag enforces the JSON Schema
 * server-side, which is what `claude -p` cannot do.
 *
 * Two hard-won invocation details, both measured 2026-08-11:
 *   - stdin MUST be closed. Without it codex blocks forever on
 *     "Reading additional input from stdin..." and never calls the API.
 *   - `minimal` effort does not exist on these models; `low` is the floor.
 *
 * Results are cached by content hash so re-runs and incremental updates skip
 * unchanged files entirely.
 */
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  LLM_ENTITY_TYPES,
  LLM_PREDICATES,
  LlmExtractedGraph,
  type StoredEntity,
  type StoredRelation,
} from "./schema";

/** Bumping this invalidates every cache entry - do it when the prompt changes. */
const PROMPT_VERSION = 3;

const MODEL = "gpt-5.3-codex-spark";
const EFFORT = "low";
const CACHE_DIR = "tools/codegraph/llm-cache";

/** Per-file input cap. Larger files are truncated with an explicit marker so
 *  the model knows it is seeing a prefix rather than silently inventing the
 *  rest - that truncation is what sent spark off reading the repo in testing. */
const MAX_BYTES = 40_000;

const SYSTEM = `Extract a knowledge graph from one file of a brewery-management codebase (Next.js + Supabase).

Extract ONLY what this file makes true. Every relation must connect two entities you extracted. Descriptions are one line, grounded in this file, written to disambiguate it from same-named things elsewhere. Use identifiers that literally appear in the file - never invent or abbreviate a name. Bias hard toward precision: a wrong edge propagates through multi-hop queries, a missing one does not.

Name an API_ENDPOINT or WEBHOOK as "VERB /path" (e.g. "POST /api/square/webhook") so handlers in different routes never collide.

A WEBHOOK is a handler for an event originating outside this system; give it a triggered_by edge from the EXTERNAL_SYSTEM that fires it.

Do not describe imports, function calls, database reads/writes, or SQL objects. Those are extracted separately by a parser and are not yours to report.

Do NOT relate two things defined inside this same file to each other - that is the parser's job, and dressing a function call up as one of the predicates above corrupts the graph. Every relation you emit should cross a boundary this file sits on: an external system that triggers it, a document that describes it, or a feature it verifies.

Most files yield only one or two entities, and many yield no relations at all. Returning empty arrays is the correct answer far more often than not.`;

function jsonSchema(): unknown {
  const entity = {
    type: "object",
    additionalProperties: false,
    required: ["name", "type", "description", "file_path"],
    properties: {
      name: { type: "string" },
      type: { type: "string", enum: [...LLM_ENTITY_TYPES] },
      description: { type: "string" },
      file_path: { type: "string" },
    },
  };
  const relation = {
    type: "object",
    additionalProperties: false,
    required: ["source", "predicate", "target"],
    properties: {
      source: { type: "string" },
      predicate: { type: "string", enum: [...LLM_PREDICATES] },
      target: { type: "string" },
    },
  };
  return {
    type: "object",
    additionalProperties: false,
    required: ["entities", "relations"],
    properties: {
      entities: { type: "array", items: entity },
      relations: { type: "array", items: relation },
    },
  };
}


/**
 * Typed-edge constraints.
 *
 * Each LLM predicate has exactly one legal (domain, range) pair. In the slice
 * every `triggered_by` came back reversed ("Square triggered_by the webhook"),
 * so rather than re-prompt for direction we flip anything that matches the
 * inverse and drop what matches neither. Deterministic, and it cannot regress.
 */
const EDGE_TYPES: Record<string, { from: string; to: string }> = {
  // The handler is triggered by the outside system, never the reverse.
  triggered_by: { from: "WEBHOOK", to: "EXTERNAL_SYSTEM" },
  // The thing points at the doc that describes it.
  documented_in: { from: "*", to: "DOC" },
  // A feature is verified by a test/doc, so the feature is the source.
  verifies: { from: "FEATURE", to: "*" },
};

const typeOk = (want: string, got: string | undefined) =>
  want === "*" ? got !== undefined : got === want;

/** A DOC must be an actual document path; a FEATURE an actual tracker id.
 *  Without this the model uses them as generic buckets for code symbols. */
function entityShapeOk(e: { name: string; type: string }): boolean {
  if (e.type === "DOC") return /\.(md|mdx)$/i.test(e.name);
  if (e.type === "FEATURE") return /^F\d{3}$/.test(e.name);
  return true;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function cacheKey(relPath: string, content: string): string {
  return sha(`${PROMPT_VERSION} ${MODEL} ${relPath} ${content}`);
}

/** Run one codex exec call. Rejects on non-zero exit or timeout. */
function runCodex(
  repoRoot: string,
  prompt: string,
  schemaPath: string,
  outPath: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "exec",
      "--ignore-user-config", // the global default is sol @ xhigh - far too slow here
      "-s",
      "read-only",
      "--ephemeral",
      "--skip-git-repo-check",
      "-m",
      MODEL,
      "-c",
      `model_reasoning_effort="${EFFORT}"`,
      "--output-schema",
      schemaPath,
      "-o",
      outPath,
      prompt,
    ];
    // execFile with an argument array: no shell, so nothing in the prompt is
    // interpreted. Closing stdin below is the `< /dev/null` that keeps codex
    // from blocking forever waiting for input.
    const child = execFile(
      "codex",
      args,
      { cwd: repoRoot, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
      (err) => (err ? reject(err) : resolve()),
    );
    child.stdin?.end();
  });
}

export type LlmPassOptions = {
  files: string[];
  commit: string;
  concurrency?: number;
  timeoutMs?: number;
  onProgress?: (done: number, total: number, file: string, cached: boolean) => void;
};

export async function runLlmPass(
  repoRoot: string,
  opts: LlmPassOptions,
): Promise<{ entities: StoredEntity[]; relations: StoredRelation[] }> {
  const cacheDir = join(repoRoot, CACHE_DIR);
  mkdirSync(cacheDir, { recursive: true });

  const schemaPath = join(cacheDir, "_schema.json");
  writeFileSync(schemaPath, JSON.stringify(jsonSchema()));

  const entities: StoredEntity[] = [];
  const relations: StoredRelation[] = [];
  const concurrency = opts.concurrency ?? 6;
  const timeoutMs = opts.timeoutMs ?? 240_000;
  let done = 0;

  const absorb = (relPath: string, parsed: LlmExtractedGraph) => {
    const kept = parsed.entities.filter(entityShapeOk);
    const typeOfName = new Map(kept.map((e) => [e.name, e.type as string]));
    for (const e of kept) {
      entities.push({ ...e, aliases: [], extractor: "llm" });
    }
    for (const r of parsed.relations) {
      // No orphaned edges: the model is told this, but enforce it too.
      if (!typeOfName.has(r.source) || !typeOfName.has(r.target)) continue;
      const rule = EDGE_TYPES[r.predicate];
      if (!rule) continue;
      const s = typeOfName.get(r.source);
      const t = typeOfName.get(r.target);
      let { source, target } = r;
      if (!(typeOk(rule.from, s) && typeOk(rule.to, t))) {
        // Reversed? Flip it. Otherwise the edge is unsalvageable — drop it.
        if (typeOk(rule.from, t) && typeOk(rule.to, s)) {
          [source, target] = [r.target, r.source];
        } else {
          continue;
        }
      }
      relations.push({
        source,
        predicate: r.predicate,
        target,
        file_path: relPath,
        commit: opts.commit,
        extractor: "llm",
      });
    }
  };

  const worker = async (queue: string[]) => {
    for (;;) {
      const relPath = queue.shift();
      if (!relPath) return;

      const abs = join(repoRoot, relPath);
      if (!existsSync(abs)) continue;
      const raw = readFileSync(abs, "utf8");
      const key = cacheKey(relPath, raw);
      const cachePath = join(cacheDir, `${key}.json`);

      if (existsSync(cachePath)) {
        const cached = LlmExtractedGraph.safeParse(
          JSON.parse(readFileSync(cachePath, "utf8")).graph,
        );
        if (cached.success) {
          absorb(relPath, cached.data);
          opts.onProgress?.(++done, opts.files.length, relPath, true);
          continue;
        }
      }

      const truncated = raw.length > MAX_BYTES;
      const body = truncated ? raw.slice(0, MAX_BYTES) : raw;
      const prompt =
        `${SYSTEM}\n\nfile_path: ${relPath}\n` +
        (truncated ? `(NOTE: truncated to the first ${MAX_BYTES} bytes)\n` : "") +
        `---\n${body}`;
      const outPath = join(cacheDir, `_out_${key}.json`);

      let parsed: LlmExtractedGraph | undefined;
      // One retry: the schema is enforced server-side, so a failure here is a
      // transport or timeout problem, not a malformed-output problem.
      for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
        try {
          await runCodex(repoRoot, prompt, schemaPath, outPath, timeoutMs);
          const result = LlmExtractedGraph.safeParse(
            JSON.parse(readFileSync(outPath, "utf8")),
          );
          if (result.success) parsed = result.data;
        } catch {
          // fall through to retry, then give up on this file
        }
      }

      if (parsed) {
        writeFileSync(
          cachePath,
          JSON.stringify({
            file_path: relPath,
            content_sha: sha(raw),
            model: MODEL,
            graph: parsed,
          }),
        );
        absorb(relPath, parsed);
      }
      opts.onProgress?.(++done, opts.files.length, relPath, false);
    }
  };

  const queue = [...opts.files];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, () => worker(queue)),
  );

  return { entities, relations };
}

/** The LLM corpus: files a parser cannot interpret. Everything else is
 *  deterministic and must not be sent to a model. */
export function llmCorpus(repoRoot: string): string[] {
  const list = (args: string[]) =>
    execFileSync("find", args, { cwd: repoRoot, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);

  return [
    // Docs that describe architecture. docs/progress is session history, not
    // architecture, and is deliberately excluded.
    ...list(["docs/agents", "docs/spec", "docs/data-model", "-name", "*.md"]),
    "README.md",
    "AGENTS.md",
    // Boundary code: intent here is not recoverable from syntax.
    ...list(["src/app/api", "-name", "route.ts"]),
    ...list(["src/integrations", "-name", "*.ts", "-not", "-path", "*__tests__*"]),
  ];
}
