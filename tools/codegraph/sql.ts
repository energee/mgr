/**
 * Deterministic database pass.
 *
 * Node existence comes from `supabase/live-catalog.snapshot.txt` (what is
 * actually live). Migration DDL is parsed only for edges the snapshot cannot
 * express: policy predicates, trigger bodies, view definitions, and
 * migration->object provenance.
 *
 * The one deviation: the snapshot has no VIEW lines, but 20 of the 88
 * relations the app queries are views. Views are therefore taken from the
 * migration chain and tagged db_source: "chain" so query answers can flag
 * them as snapshot-unverified — the same distinction `make check-deploy-state`
 * draws.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { StoredEntity, StoredRelation } from "./schema";

export type SqlPassResult = {
  entities: StoredEntity[];
  relations: StoredRelation[];
};

/** Mask dollar-quoted function bodies so statement splitting is not fooled. */
function maskDollarQuoted(sql: string): string {
  return sql.replace(/\$\$[\s\S]*?\$\$/g, (m) => " ".repeat(m.length));
}

function statements(sql: string): string[] {
  const masked = maskDollarQuoted(sql);
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === ";") {
      out.push(sql.slice(start, i));
      start = i + 1;
    }
  }
  if (start < sql.length) out.push(sql.slice(start));
  return out;
}

/** Strip -- and block comments so they cannot contribute false matches. */
function decomment(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

export function runSqlPass(repoRoot: string): SqlPassResult {
  const entities = new Map<string, StoredEntity>();
  const relations: StoredRelation[] = [];
  const addEntity = (e: StoredEntity) => {
    if (!entities.has(e.name)) entities.set(e.name, e);
  };
  const addRel = (r: StoredRelation) => relations.push(r);

  // ---------- 1. snapshot: authoritative node set ----------
  const snapPath = "supabase/live-catalog.snapshot.txt";
  const snap = readFileSync(join(repoRoot, snapPath), "utf8");

  for (const line of snap.split("\n")) {
    const f = line.split("|");
    if (f[0] === "TABLE" && f[1]) {
      addEntity({
        name: f[1],
        type: "TABLE",
        description: `Postgres table '${f[1]}', confirmed present in the live catalog snapshot.`,
        file_path: snapPath,
        aliases: [],
        extractor: "sql",
        db_source: "snapshot",
      });
    } else if (f[0] === "FUNC" && f[1]) {
      const name = f[1].split("(")[0];
      addEntity({
        name,
        type: "DB_FUNCTION",
        description: `Postgres function ${f[1]}, confirmed live.`,
        file_path: snapPath,
        aliases: [],
        extractor: "sql",
        db_source: "snapshot",
      });
    } else if (f[0] === "POLICY" && f[1] && f[2]) {
      // POLICY|table|policy_name|command|permissive|role|hash
      const [, table, policy, command, permissive, role] = f;
      const qp = `${table}.${policy}`;
      addEntity({
        name: qp,
        type: "RLS_POLICY",
        description: `RLS policy '${policy}' on ${table}: ${command}, ${permissive}, role ${role}. Confirmed live.`,
        file_path: snapPath,
        aliases: [],
        extractor: "sql",
        db_source: "snapshot",
      });
      addRel({ source: qp, predicate: "protects", target: table, file_path: snapPath, extractor: "sql" });
    } else if (f[0] === "TRIG" && f[1] && f[2]) {
      // TRIG|trigger_name|table|hash
      const [, trig, table] = f;
      const qt = `${table}.${trig}`;
      addEntity({
        name: qt,
        type: "TRIGGER",
        description: `Trigger '${trig}' on table ${table}. Confirmed live.`,
        file_path: snapPath,
        aliases: [],
        extractor: "sql",
        db_source: "snapshot",
      });
      addRel({ source: qt, predicate: "fires_on", target: table, file_path: snapPath, extractor: "sql" });
    }
  }

  // ---------- 2. migrations: edges + views ----------
  const migDir = join(repoRoot, "supabase/migrations");
  const migFiles = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();

  for (const mig of migFiles) {
    const rel = `supabase/migrations/${mig}`;
    const raw = readFileSync(join(migDir, mig), "utf8");
    addEntity({
      name: mig,
      type: "MIGRATION",
      description: `Migration ${mig}.`,
      file_path: rel,
      aliases: [],
      extractor: "sql",
    });

    for (const stmtRaw of statements(raw)) {
      const stmt = decomment(stmtRaw);

      // CREATE POLICY <name> ON <table> ... user_has_permission('perm')
      const pol = /create\s+policy\s+"?([a-z0-9_]+)"?\s+on\s+"?(?:public\.)?([a-z0-9_]+)"?/i.exec(stmt);
      if (pol) {
        const [, policyRaw, table] = pol;
        const policy = `${table}.${policyRaw}`;
        addRel({ source: mig, predicate: "creates", target: policy, file_path: rel, extractor: "sql" });
        // policy may predate the snapshot node (dropped later) — only edge if known
        if (!entities.has(policy)) {
          addEntity({
            name: policy,
            type: "RLS_POLICY",
            description: `RLS policy '${policy}' on ${table}, defined in ${mig}. Not present in the live snapshot.`,
            file_path: rel,
            aliases: [],
            extractor: "sql",
            db_source: "chain",
          });
          addRel({ source: policy, predicate: "protects", target: table, file_path: rel, extractor: "sql" });
        }
        for (const m of stmt.matchAll(/user_has_permission\(\s*'([a-z0-9_:]+)'\s*\)/gi)) {
          const perm = m[1];
          addEntity({
            name: perm,
            type: "PERMISSION",
            description: `Permission string '${perm}', checked via user_has_permission() in RLS policies.`,
            file_path: rel,
            aliases: [],
            extractor: "sql",
          });
          addRel({ source: policy, predicate: "requires", target: perm, file_path: rel, extractor: "sql" });
        }
        continue;
      }

      // CREATE TRIGGER <name> ... ON <table> ... EXECUTE FUNCTION <fn>
      const trg = /create\s+trigger\s+"?([a-z0-9_]+)"?[\s\S]*?\bon\s+"?(?:public\.)?([a-z0-9_]+)"?[\s\S]*?\bexecute\s+(?:function|procedure)\s+"?(?:public\.)?([a-z0-9_]+)"?/i.exec(stmt);
      if (trg) {
        const [, triggerRaw, trigTable, fn] = trg;
        const trigger = `${trigTable}.${triggerRaw}`;
        addRel({ source: mig, predicate: "creates", target: trigger, file_path: rel, extractor: "sql" });
        if (entities.has(trigger) && entities.has(fn)) {
          addRel({ source: trigger, predicate: "executes", target: fn, file_path: rel, extractor: "sql" });
        }
        continue;
      }

      // CREATE [OR REPLACE] VIEW <name> AS <body>
      const vw = /create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+"?(?:public\.)?([a-z0-9_]+)"?\s*(?:with\s*\([^)]*\)\s*)?as\b([\s\S]*)/i.exec(stmt);
      if (vw) {
        const [, view, body] = vw;
        // Later migrations legitimately redefine a view; last definition wins.
        entities.set(view, {
          name: view,
          type: "VIEW",
          description: `Postgres view '${view}', last defined in ${mig}. Views are absent from the live snapshot, so this is chain-only.`,
          file_path: rel,
          aliases: [],
          extractor: "sql",
          db_source: "chain",
        });
        addRel({ source: mig, predicate: "creates", target: view, file_path: rel, extractor: "sql" });
        const bases = new Set<string>();
        for (const m of body.matchAll(/\b(?:from|join)\s+"?(?:public\.)?([a-z0-9_]+)"?/gi)) bases.add(m[1]);
        for (const base of bases) {
          if (base === view) continue;
          addRel({ source: view, predicate: "derives_from", target: base, file_path: rel, extractor: "sql" });
        }
        continue;
      }

      // CREATE TABLE / FUNCTION -> provenance edges only (nodes come from snapshot)
      const tbl = /create\s+table\s+(?:if\s+not\s+exists\s+)?"?(?:public\.)?([a-z0-9_]+)"?/i.exec(stmt);
      if (tbl && entities.has(tbl[1])) {
        addRel({ source: mig, predicate: "creates", target: tbl[1], file_path: rel, extractor: "sql" });
        continue;
      }
      const fn = /create\s+(?:or\s+replace\s+)?function\s+"?(?:public\.)?([a-z0-9_]+)"?/i.exec(stmt);
      if (fn && entities.has(fn[1])) {
        addRel({ source: mig, predicate: "creates", target: fn[1], file_path: rel, extractor: "sql" });
      }
    }
  }

  // Drop edges whose endpoints were never materialised (no orphaned edges).
  const known = entities;
  const kept = relations.filter((r) => known.has(r.source) && known.has(r.target));
  return { entities: [...entities.values()], relations: kept };
}
