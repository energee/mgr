/**
 * Server/Client Entity Import Boundary
 *
 * Every per-entity `index.ts` assembles the server-safe `core.ts` with the
 * React `presentation.tsx` half via `createEntityConfig`. `presentation.tsx`
 * files call client-only factories (e.g. `createRevisionHistoryDisplay`,
 * exported by a "use client" module) at module-evaluation top level, so
 * importing the assembled config from a Server Component — rather than the
 * server-safe `core.ts` — throws "Attempted to call X() from the server but
 * X is on the client" as soon as Next.js evaluates that module in the server
 * graph (Sentry MGR-T / issue 7611936203, reproduced by an earlier revision
 * of production/batches/loading.tsx importing `batchEntity` for its column
 * count instead of `batchCore`).
 *
 * Walks every non-"use client" file under src/app and asserts none import an
 * assembled `@/entities/<name>` config — only the server-safe `.../core` (or
 * the server-safe `@/entities/cores` registry) is allowed from server code.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const APP_ROOT = join(ROOT, "src/app");

/** All .ts/.tsx files under src/app, recursively. */
function appSourceFiles(): string[] {
  return readdirSync(APP_ROOT, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".test.ts") && !e.name.endsWith(".test.tsx"))
    .map((e) => join(e.parentPath, e.name));
}

/** Matches `from "@/entities/<name>"` but not `.../core` or `@/entities/cores`. */
const ASSEMBLED_ENTITY_IMPORT = /from\s+["']@\/entities\/([a-z-]+)["']/g;

describe("Server/client entity import boundary", () => {
  const files = appSourceFiles();

  it("sanity: app source files found", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("no Server Component/route under src/app imports an assembled entity config", () => {
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const isClientModule = /^"use client";?/m.test(source);
      if (isClientModule) continue;

      for (const match of source.matchAll(ASSEMBLED_ENTITY_IMPORT)) {
        const entityName = match[1];
        if (entityName === "cores") continue; // @/entities/cores is server-safe
        violations.push(
          `${file.slice(ROOT.length + 1)}: imports "@/entities/${entityName}" (assembled, client) ` +
            `— use "@/entities/${entityName}/core" instead`
        );
      }
    }
    expect(
      violations,
      `Server files importing assembled (client) entity configs:\n${violations.join("\n")}\n` +
        `Assembled configs pull in presentation.tsx, which calls client-only factories at module ` +
        `scope — importing them from server code throws at request time.`
    ).toEqual([]);
  });
});
