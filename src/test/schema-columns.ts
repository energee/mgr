/**
 * Generated-schema column parser for config-vs-schema tests.
 *
 * Several tests need to know which columns a relation actually exposes so they
 * can assert that an entity config only names real columns. The source of
 * truth is `src/types/supabase.ts`, generated from the database, which covers
 * both `Tables` and `Views`. Parsing it with a regex (rather than importing the
 * types) is deliberate: the column set has to be available as *runtime* data.
 *
 * Consumers:
 * - `src/app/api/chat/__tests__/entity-map-sync.test.ts` (defaultSort,
 *   keyFields, detailHeader)
 * - `src/entities/__tests__/section-fields-schema-sync.test.ts` (editable
 *   section fields — issue #612)
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Parses `src/types/supabase.ts` and returns relation name → set of Row column
 * names, covering both Tables and Views.
 *
 * Callers should sanity-check the result (a known relation with a known
 * column) so a supabase-gen format change breaks loudly rather than silently
 * returning an empty map.
 */
export function parseSchemaColumns(): Map<string, Set<string>> {
  const schemaPath = path.resolve(process.cwd(), "src/types/supabase.ts");
  const src = fs.readFileSync(schemaPath, "utf8");
  const relations = new Map<string, Set<string>>();
  // Matches `      relation_name: {\n        Row: { ...columns... }`
  const relationRe = /\n {6}(\w+): \{\n {8}Row: \{([\s\S]*?)\n {8}\}/g;
  let match: RegExpExecArray | null;
  while ((match = relationRe.exec(src)) !== null) {
    const cols = new Set<string>();
    for (const line of match[2].split("\n")) {
      const colMatch = line.match(/^ {10}(\w+)\??:/);
      if (colMatch) cols.add(colMatch[1]);
    }
    relations.set(match[1], cols);
  }
  return relations;
}
