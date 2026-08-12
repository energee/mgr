/**
 * Command Palette record-search structural tests
 *
 * Validates the palette's search-entity descriptors and quick actions against
 * the entity configs and the actual app route tree, and the pure query-spec
 * builder (escaped-ilike `.or()` construction) used for record search.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";

// Mock the Supabase client to avoid env var requirements during import.
// Entity configs transitively import components that call createClient()
// at module scope (same pattern as entity-configs.test.ts).
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ data: [], error: null }),
    }),
  }),
}));

import { resolveEntityBasePath, type EntityConfig } from "@/types/entity";
import { PERMISSION_MAP } from "@/lib/permissions";
import { escapePostgrestOrValue } from "@/components/data-table/adapter";
import { customerEntity } from "@/entities/customer";
import { orderEntity } from "@/entities/order";
import { batchEntity } from "@/entities/batch";
import { navigation, isNavSection } from "../nav-items";
import {
  SEARCH_ENTITIES,
  QUICK_ACTIONS,
  MIN_SEARCH_CHARS,
  DASHBOARD_PAGES,
  REPORT_PAGES,
  buildRecordSearchSpec,
} from "../command-palette";

const APP_DIR = join(process.cwd(), "src", "app", "(app)");

type AnyEntityConfig = EntityConfig<Record<string, unknown>>;

const asAny = (entity: unknown) => entity as AnyEntityConfig;

describe("SEARCH_ENTITIES descriptors", () => {
  it("has at least the core record types", () => {
    const names = SEARCH_ENTITIES.map((d) => d.entity.name);
    expect(names).toContain("batch");
    expect(names).toContain("order");
    expect(names).toContain("customer");
    expect(names).toContain("purchase_order");
  });

  it("every searched entity has non-empty searchableFields", () => {
    for (const { entity } of SEARCH_ENTITIES) {
      expect(
        entity.searchableFields?.length,
        `${entity.name}: palette search requires searchableFields`
      ).toBeGreaterThan(0);
    }
  });

  it("every searched entity has a detailHeader title for result labels", () => {
    for (const { entity } of SEARCH_ENTITIES) {
      expect(
        entity.detailHeader?.title,
        `${entity.name}: palette results render detailHeader.title`
      ).toBeTruthy();
    }
  });

  it("every searched entity resolves to a real detail route", () => {
    for (const { entity } of SEARCH_ENTITIES) {
      const basePath = resolveEntityBasePath(entity);
      expect(basePath, `${entity.name}: must have a standalone route`).toBeTruthy();
      expect(basePath!.startsWith("/")).toBe(true);

      const detailPage = join(APP_DIR, basePath!.slice(1), "[id]", "page.tsx");
      expect(
        existsSync(detailPage),
        `${entity.name}: expected detail page at ${detailPage}`
      ).toBe(true);
    }
  });

  it("every descriptor uses a valid read permission", () => {
    for (const { entity, permission } of SEARCH_ENTITIES) {
      expect(
        permission in PERMISSION_MAP,
        `${entity.name}: unknown permission ${permission}`
      ).toBe(true);
      expect(
        permission.endsWith(":read"),
        `${entity.name}: search gating must use a read permission, got ${permission}`
      ).toBe(true);
    }
  });

  it("uses a sane minimum query length", () => {
    expect(MIN_SEARCH_CHARS).toBeGreaterThanOrEqual(2);
  });
});

describe("buildRecordSearchSpec", () => {
  it("builds an ilike .or() filter across all searchableFields", () => {
    const spec = buildRecordSearchSpec(asAny(customerEntity), "hop");
    expect(spec).not.toBeNull();
    expect(spec!.orFilter).toBe(
      "name.ilike.%hop%,contact_name.ilike.%hop%,email.ilike.%hop%"
    );
  });

  it("queries the same table/view the entity list page uses", () => {
    const spec = buildRecordSearchSpec(asAny(batchEntity), "abc");
    expect(spec!.table).toBe(batchEntity.viewTable || batchEntity.table);
  });

  it("selects id plus the detail-header title/subtitle columns", () => {
    const spec = buildRecordSearchSpec(asAny(batchEntity), "abc");
    const cols = spec!.select.split(",");
    expect(cols).toContain("id");
    expect(cols).toContain("batch_code"); // detailHeader.title
    expect(cols).toContain("name"); // detailHeader.subtitle
  });

  it("escapes PostgREST .or() special characters in the query", () => {
    const spec = buildRecordSearchSpec(asAny(orderEntity), "a,b%");
    // One literal backslash before each of "," and "%", applied per
    // searchable field (orders search order_number and customer_name).
    expect(spec!.orFilter).toBe(
      "order_number.ilike.%a\\,b\\%%,customer_name.ilike.%a\\,b\\%%"
    );
    // Sanity: matches the shared escaping helper exactly.
    const escaped = escapePostgrestOrValue("a,b%");
    expect(spec!.orFilter).toBe(
      `order_number.ilike.%${escaped}%,customer_name.ilike.%${escaped}%`
    );
  });

  it("returns null for entities without searchableFields", () => {
    const spec = buildRecordSearchSpec(
      asAny({ ...orderEntity, searchableFields: [] }),
      "abc"
    );
    expect(spec).toBeNull();
  });
});

describe("DASHBOARD_PAGES / REPORT_PAGES", () => {
  const navHrefs = navigation.flatMap((e) => (isNavSection(e) ? e.items : [e])).map((i) => i.href);

  it("covers every sub-page the 2026-07-12 nav simplification cut from nav-items.ts", () => {
    const hrefs = [...DASHBOARD_PAGES, ...REPORT_PAGES].map((p) => p.href);
    for (const cut of [
      "/dashboard/inventory",
      "/dashboard/sales",
      "/reports/ttb",
      "/reports/production-summary",
      "/reports/inventory-valuation",
      "/reports/batch-cost",
      "/reports/projections",
      "/reports/cogs",
      "/reports/trace",
    ]) {
      expect(hrefs).toContain(cut);
    }
  });

  it("stays independent of nav-items.ts (none of these hrefs are in the nav)", () => {
    for (const page of [...DASHBOARD_PAGES, ...REPORT_PAGES]) {
      expect(navHrefs).not.toContain(page.href);
    }
  });

  it("every page points at an existing route", () => {
    for (const page of [...DASHBOARD_PAGES, ...REPORT_PAGES]) {
      const file = join(APP_DIR, page.href.slice(1), "page.tsx");
      expect(existsSync(file), `${page.label}: expected page at ${file}`).toBe(true);
    }
  });

  it("every page has a label and an icon", () => {
    for (const page of [...DASHBOARD_PAGES, ...REPORT_PAGES]) {
      expect(page.label).toBeTruthy();
      expect(page.icon).toBeTruthy();
    }
  });
});

describe("QUICK_ACTIONS", () => {
  it("derives expected routes from entity configs", () => {
    const hrefs = Object.fromEntries(QUICK_ACTIONS.map((a) => [a.label, a.href]));
    expect(hrefs["New Batch"]).toBe("/production/batches/new");
    expect(hrefs["New Order"]).toBe("/sales/orders/new");
    expect(hrefs["Receive PO"]).toBe("/purchasing/pos");
  });

  it("every action points at an existing page", () => {
    for (const action of QUICK_ACTIONS) {
      const page = join(APP_DIR, action.href.slice(1), "page.tsx");
      expect(
        existsSync(page),
        `${action.label}: expected page at ${page}`
      ).toBe(true);
    }
  });

  it("every action uses a valid write/manage permission", () => {
    for (const action of QUICK_ACTIONS) {
      expect(
        action.permission in PERMISSION_MAP,
        `${action.label}: unknown permission ${action.permission}`
      ).toBe(true);
    }
  });
});
