/**
 * Entity resolution.
 *
 * The cookbook uses an LLM to cluster surface-form variants, because its
 * entities come from prose where the same thing appears as "Buzz Aldrin" and
 * "Edwin Aldrin". This graph is different: measured on the full 3,892-entity
 * build, there were ZERO within-type name collisions. The deterministic passes
 * mint canonical names by construction - repo-relative file paths, table names
 * straight from the live catalog snapshot, policies qualified as table.policy.
 * There is nothing for a model to arbitrate.
 *
 * Variants only arise where names come from the LLM pass or from prose inside
 * files, and there they are deterministically normalizable rather than a
 * judgment call:
 *   - DOC paths written relatively ("./debugging.md") vs repo-relative
 *   - EXTERNAL_SYSTEM casing and spacing ("Square", "square", "Square API")
 *
 * So resolution here is rules, not inference. That keeps the pass free, exact,
 * and repeatable - and it cannot commit the paper's over-merge failure, which
 * on a code graph would be far more damaging than on a prose corpus (folding
 * TABLE batches into MODULE src/entities/batch/core.ts would corrupt every
 * multi-hop answer that crosses it).
 *
 * Both failure modes the cookbook names are still reported: entities that no
 * rule touched, and merges that look suspicious enough to eyeball.
 */
import type { StoredEntity, StoredRelation } from "./schema";
import type { Graph } from "./store";

/** The persisted node-link shape, minus the metadata save() adds. */
type GraphBody = Omit<Graph, "commit" | "built_at">;

export type ResolutionReport = {
  /** Entities merged into a canonical form, as canonical <- [variants]. */
  merged: { canonical: string; aliases: string[] }[];
  /** Merges where names differ by more than case/punctuation. Eyeball these. */
  suspicious: { canonical: string; aliases: string[]; reason: string }[];
  /** Entities no rule matched. Not an error - just the silent-loss surface. */
  untouched: number;
  /** Edges rewritten because an endpoint was merged away. */
  edgesRewritten: number;
};

/** Strip a leading ./ or / and collapse duplicate slashes. */
function normalizeDocPath(name: string): string {
  return name.replace(/^\.?\//, "").replace(/\/{2,}/g, "/");
}

/** Case- and punctuation-insensitive key for external system names. */
function externalKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Compute the canonical name for an entity, or undefined to leave it alone.
 * Only types whose names come from prose or a model are eligible.
 */
function canonicalNameFor(
  entity: StoredEntity,
  docPathsInRepo: Set<string>,
  externalCanon: Map<string, string>,
): string | undefined {
  if (entity.type === "DOC") {
    const stripped = normalizeDocPath(entity.name);
    if (stripped !== entity.name && docPathsInRepo.has(stripped)) return stripped;
    // A bare filename that matches exactly one real doc path resolves to it.
    if (!stripped.includes("/")) {
      const matches = [...docPathsInRepo].filter((p) => p.endsWith(`/${stripped}`));
      if (matches.length === 1) return matches[0];
    }
    return undefined;
  }
  if (entity.type === "EXTERNAL_SYSTEM") {
    const canon = externalCanon.get(externalKey(entity.name));
    return canon && canon !== entity.name ? canon : undefined;
  }
  return undefined;
}

export function resolveGraph(graph: GraphBody): {
  graph: GraphBody;
  report: ResolutionReport;
} {
  const docPathsInRepo = new Set(
    graph.nodes
      .filter((e) => e.type === "DOC" && e.name.includes("/"))
      .map((e) => e.name),
  );

  // For each external-system key, the longest surface form wins - "QuickBooks
  // Online" carries more information than "qbo" and is the better display name.
  const externalCanon = new Map<string, string>();
  for (const e of graph.nodes) {
    if (e.type !== "EXTERNAL_SYSTEM") continue;
    const k = externalKey(e.name);
    const cur = externalCanon.get(k);
    if (!cur || e.name.length > cur.length) externalCanon.set(k, e.name);
  }

  const rename = new Map<string, string>();
  for (const e of graph.nodes) {
    const canon = canonicalNameFor(e, docPathsInRepo, externalCanon);
    if (canon && canon !== e.name) rename.set(e.name, canon);
  }

  // Fold entities together, accumulating aliases.
  const byName = new Map<string, StoredEntity>();
  const aliasesOf = new Map<string, Set<string>>();
  for (const e of graph.nodes) {
    const target = rename.get(e.name) ?? e.name;
    if (target !== e.name) {
      (aliasesOf.get(target) ?? aliasesOf.set(target, new Set()).get(target)!).add(e.name);
    }
    const existing = byName.get(target);
    if (!existing) {
      byName.set(target, { ...e, name: target, aliases: [...e.aliases] });
    } else {
      // Prefer a snapshot-confirmed record; union the aliases either way.
      const better = existing.db_source === "snapshot" ? existing : e;
      byName.set(target, {
        ...better,
        name: target,
        aliases: [...new Set([...existing.aliases, ...e.aliases])],
      });
    }
  }
  for (const [name, extra] of aliasesOf) {
    const e = byName.get(name);
    if (e) e.aliases = [...new Set([...e.aliases, ...extra])];
  }

  // Rewrite edges through the rename map, then drop self-loops the merge created.
  let edgesRewritten = 0;
  const seen = new Set<string>();
  const links: StoredRelation[] = [];
  for (const r of graph.links) {
    const source = rename.get(r.source) ?? r.source;
    const target = rename.get(r.target) ?? r.target;
    if (source !== r.source || target !== r.target) edgesRewritten++;
    if (source === target) continue;
    if (!byName.has(source) || !byName.has(target)) continue;
    const k = `${source} ${r.predicate} ${target} ${r.file_path}`;
    if (seen.has(k)) continue;
    seen.add(k);
    links.push({ ...r, source, target });
  }

  const merged = [...aliasesOf.entries()].map(([canonical, s]) => ({
    canonical,
    aliases: [...s],
  }));

  // A merge is "suspicious" when the variants are not just case/punctuation
  // apart - that is where a rule could plausibly be wrong and deserves a human.
  const suspicious = merged
    .map((m) => {
      const odd = m.aliases.filter((a) => externalKey(a) !== externalKey(m.canonical));
      return odd.length
        ? { ...m, reason: "variant differs by more than case/punctuation" }
        : undefined;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);

  return {
    graph: { nodes: [...byName.values()], links },
    report: {
      merged,
      suspicious,
      untouched: graph.nodes.length - rename.size,
      edgesRewritten,
    },
  };
}
