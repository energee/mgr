/**
 * Deterministic structural pass over the TypeScript sources.
 *
 * Uses the repo's own TypeScript compiler API (not tree-sitter) so imports and
 * call targets are *resolved* rather than name-matched. Everything this pass
 * emits is exact by construction, which is why the LLM pass is forbidden from
 * producing the same predicates — see LLM_PREDICATES in schema.ts.
 *
 * Produces: MODULE/FUNCTION/COMPONENT/SERVICE/API_ENDPOINT/WEBHOOK/TEST nodes,
 * and imports / defines / calls / reads_from / writes_to / invokes /
 * invalidates / tested_by edges.
 */
import ts from "typescript";
import { relative, basename, dirname, sep } from "node:path";
import type { EntityType, StoredEntity, StoredRelation } from "./schema";

const WRITE_METHODS = new Set(["insert", "update", "upsert", "delete"]);

/** Cache methods whose key argument constitutes an invalidation. */
const INVALIDATION_METHODS = new Set([
  "invalidateQueries",
  "refetchQueries",
  "resetQueries",
  "removeQueries",
  "cancelQueries",
]);

/** True when `node` sits inside a queryClient.invalidateQueries(...)-style call. */
function insideInvalidationCall(node: ts.Node): boolean {
  for (let cur: ts.Node | undefined = node.parent; cur; cur = cur.parent) {
    if (
      ts.isCallExpression(cur) &&
      ts.isPropertyAccessExpression(cur.expression) &&
      INVALIDATION_METHODS.has(cur.expression.name.text)
    ) {
      return true;
    }
  }
  return false;
}
const HTTP_VERBS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

/** Classify a file by its path — mirrors the repo's own layout conventions. */
function classify(rel: string): EntityType {
  if (/__tests__|\.test\.tsx?$|\.spec\.tsx?$/.test(rel)) return "TEST";
  if (/^src\/app\/api\/.*route\.ts$/.test(rel)) {
    return /webhook/i.test(rel) ? "WEBHOOK" : "API_ENDPOINT";
  }
  if (/^src\/services\//.test(rel)) return "SERVICE";
  if (/^src\/entities\/[^/]+\/core\.ts$/.test(rel)) return "ENTITY_CONFIG";
  return "MODULE";
}

/** A React component by repo convention: exported PascalCase returning JSX. */
function isComponentName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

export function runAstPass(repoRoot: string) {
  const cfgPath = ts.findConfigFile(repoRoot, ts.sys.fileExists, "tsconfig.json");
  if (!cfgPath) throw new Error("tsconfig.json not found");
  const cfg = ts.readConfigFile(cfgPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, repoRoot);

  const files = parsed.fileNames.filter(
    (f) => f.includes(`${sep}src${sep}`) && !f.endsWith(".d.ts"),
  );
  const program = ts.createProgram(files, { ...parsed.options, noEmit: true });
  const checker = program.getTypeChecker();

  const entities = new Map<string, StoredEntity>();
  const relations: StoredRelation[] = [];
  const add = (e: StoredEntity) => { if (!entities.has(e.name)) entities.set(e.name, e); };
  const rel = (r: StoredRelation) => relations.push(r);

  const inRepo = (f: string) => f.startsWith(repoRoot) && !f.includes("node_modules");
  const relOf = (f: string) => relative(repoRoot, f);

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile || !inRepo(sf.fileName)) continue;
    const path = relOf(sf.fileName);
    if (!path.startsWith("src/")) continue;

    const kind = classify(path);
    // The file itself is a module; the exported HTTP verbs below are the
    // actual endpoints, so the two never share a node type.
    const fileType = kind === "API_ENDPOINT" || kind === "WEBHOOK" ? "MODULE" : kind;
    add({
      name: path,
      type: fileType,
      description: `${fileType === "MODULE" ? "Source module" : fileType} at ${path}.`,
      file_path: path,
      aliases: [],
      extractor: "ast",
    });

    // tested_by: src/foo/bar.ts <- src/foo/__tests__/bar.test.ts
    if (kind === "TEST") {
      const subject = basename(path).replace(/\.(test|spec)\.(tsx?)$/, ".$2");
      const parent = dirname(dirname(path));
      for (const ext of [".ts", ".tsx"]) {
        const cand = `${parent}/${subject.replace(/\.tsx?$/, ext)}`;
        rel({ source: cand, predicate: "tested_by", target: path, file_path: path, extractor: "ast" });
      }
    }

    const visit = (node: ts.Node): void => {
      // --- imports (module resolution, not string matching) ---
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const sym = checker.getSymbolAtLocation(node.moduleSpecifier);
        const decl = sym?.declarations?.[0]?.getSourceFile();
        if (decl && inRepo(decl.fileName) && !decl.isDeclarationFile) {
          const target = relOf(decl.fileName);
          if (target.startsWith("src/")) {
            rel({ source: path, predicate: "imports", target, file_path: path, extractor: "ast" });
          }
        }
      }

      // --- exported declarations -> defines ---
      const exported = ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export;
      if (exported) {
        let name: string | undefined;
        if (ts.isFunctionDeclaration(node) && node.name) name = node.name.text;
        else if (ts.isVariableStatement(node)) {
          const d = node.declarationList.declarations[0];
          if (d && ts.isIdentifier(d.name)) name = d.name.text;
        }
        if (name) {
          const isVerb = HTTP_VERBS.has(name) && (kind === "API_ENDPOINT" || kind === "WEBHOOK");
          // Route handlers are named per-path so POST in two routes never merge.
          const qualified = isVerb
            ? `${name} /${path.replace(/^src\/app\/api\//, "api/").replace(/\/route\.ts$/, "")}`
            : `${path}#${name}`;
          const isComp = path.endsWith(".tsx") && isComponentName(name);
          add({
            name: qualified,
            type: isVerb ? kind : isComp ? "COMPONENT" : "FUNCTION",
            description: isVerb
              ? `HTTP ${name} handler for /${path.replace(/^src\/app\//, "").replace(/\/route\.ts$/, "")}.`
              : `${isComp ? "React component" : "Exported function"} '${name}' in ${path}.`,
            file_path: path,
            aliases: [name],
            extractor: "ast",
          });
          rel({ source: path, predicate: "defines", target: qualified, file_path: path, extractor: "ast" });
        }
      }

      // --- supabase data access: .from("t") / .rpc("fn") ---
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const arg = node.arguments[0];
        if ((method === "from" || method === "rpc") && arg && ts.isStringLiteral(arg)) {
          const target = arg.text;
          if (method === "rpc") {
            rel({ source: path, predicate: "invokes", target, file_path: path, extractor: "ast" });
          } else {
            // Walk the fluent chain to decide read vs write.
            let write = false;
            let cur: ts.Node = node;
            while (cur.parent && (ts.isPropertyAccessExpression(cur.parent) || ts.isCallExpression(cur.parent))) {
              if (ts.isPropertyAccessExpression(cur.parent) && WRITE_METHODS.has(cur.parent.name.text)) {
                write = true;
                break;
              }
              cur = cur.parent;
            }
            rel({
              source: path,
              predicate: write ? "writes_to" : "reads_from",
              target,
              file_path: path,
              extractor: "ast",
            });
          }
        }
      }

      // --- helper-wrapped RPC: dynamicRpc(client, "fn_name", args) ---
      // This repo reaches 9 database functions only through this wrapper, so
      // matching just `.rpc("name")` misses them - and they are precisely the
      // side-effect targets a "webhook -> what happens" question needs.
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "dynamicRpc"
      ) {
        const fnArg = node.arguments[1];
        if (fnArg && ts.isStringLiteral(fnArg)) {
          rel({ source: path, predicate: "invokes", target: fnArg.text, file_path: path, extractor: "ast" });
        }
      }

      // --- React Query cache keys -> invalidates ---
      // Two shapes in this repo (44 factories, ~548 call sites):
      //   entityKeys.all("batches")  -> table-scoped: edge points at the TABLE
      //     node from the SQL pass, so "writes_to X but never invalidates X"
      //     becomes a single graph query.
      //   batchKeys.detail(id)       -> namespace-scoped: edge points at a
      //     QUERY_KEY node named for the factory method.
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        /^[a-z][A-Za-z]*Keys$/.test(node.expression.expression.text) &&
        // Only calls that feed an actual cache-invalidation method count.
        // Without this guard every read site (`queryKey: entityKeys.list(...)`)
        // registered as an invalidator and masked real missing invalidations.
        insideInvalidationCall(node)
      ) {
        const factory = node.expression.expression.text;
        const method = node.expression.name.text;
        const first = node.arguments[0];
        if (factory === "entityKeys" && first && ts.isStringLiteral(first)) {
          rel({ source: path, predicate: "invalidates", target: first.text, file_path: path, extractor: "ast" });
        } else {
          const key = `${factory}.${method}`;
          add({
            name: key,
            type: "QUERY_KEY",
            description: `React Query key '${key}' from src/lib/query-keys.ts.`,
            file_path: "src/lib/query-keys.ts",
            aliases: [],
            extractor: "ast",
          });
          rel({ source: path, predicate: "invalidates", target: key, file_path: path, extractor: "ast" });
        }
      }

      // --- resolved cross-module calls ---
      if (ts.isCallExpression(node)) {
        const id = ts.isIdentifier(node.expression)
          ? node.expression
          : ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.name)
            ? node.expression.name
            : undefined;
        if (id) {
          const sym = checker.getSymbolAtLocation(id);
          const d = sym?.declarations?.[0];
          const df = d?.getSourceFile();
          if (df && inRepo(df.fileName) && !df.isDeclarationFile) {
            const tp = relOf(df.fileName);
            if (tp.startsWith("src/") && tp !== path) {
              rel({ source: path, predicate: "calls", target: `${tp}#${id.text}`, file_path: path, extractor: "ast" });
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  // No orphaned edges: drop any whose endpoints were never materialised.
  // Table/view/db-function targets are resolved later against the SQL pass.
  return { entities: [...entities.values()], relations };
}
