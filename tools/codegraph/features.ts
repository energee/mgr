/**
 * Tracker pass: deterministic FEATURE edges from docs/feature_list.json.
 *
 * The tracker is machine-readable and authoritative for what each feature
 * needs (migrations) and where it is described and verified, so these edges
 * are parsed, not inferred — unlike the LLM pass's low-recall FEATURE edges,
 * which this pass supersedes wherever both exist (same names merge; edge
 * dedup is by triple + file).
 *
 * Emitted per feature entry:
 *   FEATURE --requires-->      MIGRATION   (each `migrations[]` item)
 *   FEATURE --documented_in--> DOC         (docs/**.md paths found in
 *                                           `evidence`/`notes`, existing only)
 *   TEST    --verifies-->      FEATURE     (test files named in
 *                                           `verification`/`evidence`;
 *                                           directories expand to the test
 *                                           files inside them)
 *
 * Only paths that exist on disk become nodes — a tracker typo must not mint a
 * phantom DOC or TEST. Migration names are trusted as-is: make
 * check-deploy-state already fails the tracker when one is wrong.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { GraphPart } from "./store";
import type { StoredEntity, StoredRelation } from "./schema";

export const FEATURE_LIST_PATH = "docs/feature_list.json";

type FeatureEntry = {
  id: string;
  title?: string;
  migrations?: string[] | string; // "unaudited" sentinel is a string
  evidence?: string;
  notes?: string;
  verification?: string;
};

const DOC_RE = /docs\/[\w./-]+\.md/g;
const PATH_RE = /(?:src|e2e|scripts)\/[\w./[\]-]+/g;
const TEST_FILE_RE = /\.(test|spec)\.tsx?$/;

/** Test files inside a tracked directory, via git so ignores are respected. */
function testFilesUnder(repoRoot: string, dir: string): string[] {
  try {
    return execFileSync("git", ["ls-files", "--", dir], {
      cwd: repoRoot,
      encoding: "utf8",
    })
      .split("\n")
      .filter((f) => TEST_FILE_RE.test(f));
  } catch {
    return [];
  }
}

export function runFeaturesPass(repoRoot: string): GraphPart {
  const raw = JSON.parse(readFileSync(join(repoRoot, FEATURE_LIST_PATH), "utf8")) as {
    features?: FeatureEntry[];
  };
  const entities: StoredEntity[] = [];
  const relations: StoredRelation[] = [];
  const seen = new Set<string>();
  const addEntity = (e: StoredEntity) => {
    if (seen.has(e.name)) return;
    seen.add(e.name);
    entities.push(e);
  };

  for (const f of raw.features ?? []) {
    if (!/^F\d{3}$/.test(f.id)) continue;
    addEntity({
      name: f.id,
      type: "FEATURE",
      description: f.title ?? "",
      file_path: FEATURE_LIST_PATH,
      aliases: [],
      extractor: "tracker",
    });
    const relate = (source: string, predicate: StoredRelation["predicate"], target: string) =>
      relations.push({ source, predicate, target, file_path: FEATURE_LIST_PATH, extractor: "tracker" });

    // Migrations are declared, not discovered; the deploy-state gate keeps
    // them honest. Skip the "unaudited" sentinel (it is a string, not a list).
    if (Array.isArray(f.migrations)) {
      for (const m of f.migrations) {
        addEntity({
          name: m,
          type: "MIGRATION",
          description: "",
          file_path: `supabase/migrations/${m}`,
          aliases: [],
          extractor: "tracker",
        });
        relate(f.id, "requires", m);
      }
    }

    for (const doc of new Set(`${f.evidence ?? ""} ${f.notes ?? ""}`.match(DOC_RE) ?? [])) {
      if (!existsSync(join(repoRoot, doc))) continue;
      addEntity({
        name: doc,
        type: "DOC",
        description: "",
        file_path: doc,
        aliases: [],
        extractor: "tracker",
      });
      relate(f.id, "documented_in", doc);
    }

    // Verification commands and evidence name test files or directories of
    // them; only what exists on disk counts.
    const tests = new Set<string>();
    for (const p of `${f.verification ?? ""} ${f.evidence ?? ""}`.match(PATH_RE) ?? []) {
      const abs = join(repoRoot, p);
      if (!existsSync(abs)) continue;
      if (TEST_FILE_RE.test(p)) tests.add(p);
      else if (statSync(abs).isDirectory()) testFilesUnder(repoRoot, p).forEach((t) => tests.add(t));
    }
    for (const t of tests) {
      addEntity({
        name: t,
        type: "TEST",
        description: "",
        file_path: t,
        aliases: [],
        extractor: "tracker",
      });
      relate(t, "verifies", f.id);
    }
  }

  return { entities, relations };
}
