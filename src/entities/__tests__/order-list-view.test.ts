/**
 * Order entity ↔ order_list_details view sync test
 *
 * The order entity reads from the order_list_details view (migration 00185:
 * orders.* plus joined customer_name) so the list shows a sortable Customer
 * column, global search matches customer names server-side, and kanban cards
 * display the customer. All of these read RAW columns off the queried
 * relation (viewTable ?? table) — a misnamed field silently renders blank or
 * breaks search with a Postgres error instead of failing at compile time.
 *
 * This test parses the generated Supabase types (same approach as
 * src/app/api/chat/__tests__/entity-map-sync.test.ts) and verifies every
 * column the order config reads exists on the view.
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Mock the Supabase client to avoid env var requirements during import.
// order.tsx transitively imports components that call createClient() at
// module scope (e.g., revision-history display).
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ data: [], error: null }),
    }),
  }),
}));

import { orderEntity } from "@/entities/order";

/**
 * Parses src/types/supabase.ts and returns the Row column names for one
 * relation (table or view).
 */
function parseRelationColumns(relation: string): Set<string> {
  const schemaPath = path.resolve(process.cwd(), "src/types/supabase.ts");
  const src = fs.readFileSync(schemaPath, "utf8");
  const relationRe = new RegExp(
    `\\n {6}${relation}: \\{\\n {8}Row: \\{([\\s\\S]*?)\\n {8}\\}`
  );
  const match = src.match(relationRe);
  const cols = new Set<string>();
  if (match) {
    for (const line of match[1].split("\n")) {
      const colMatch = line.match(/^ {10}(\w+)\??:/);
      if (colMatch) cols.add(colMatch[1]);
    }
  }
  return cols;
}

describe("order entity: order_list_details view sync", () => {
  it("reads from the order_list_details view, which exists in the generated schema", () => {
    expect(orderEntity.viewTable).toBe("order_list_details");
    expect(parseRelationColumns("order_list_details").size).toBeGreaterThan(0);
    // Writes go to the base table — it must exist too.
    expect(orderEntity.table).toBe("orders");
    expect(parseRelationColumns("orders").size).toBeGreaterThan(0);
  });

  it("the view exposes every orders base column plus customer_name", () => {
    const viewCols = parseRelationColumns(orderEntity.viewTable!);
    const baseCols = parseRelationColumns(orderEntity.table);
    // View is `o.* + customer name`, so detail/edit reads lose nothing.
    for (const col of baseCols) {
      expect(viewCols, `view missing base column '${col}'`).toContain(col);
    }
    expect(viewCols).toContain("customer_name");
  });

  it("every searchableField is a real view column (server-side ilike)", () => {
    const viewCols = parseRelationColumns(orderEntity.viewTable!);
    expect(orderEntity.searchableFields).toContain("customer_name");
    for (const field of orderEntity.searchableFields ?? []) {
      expect(viewCols, `searchableField '${field}' missing from view`).toContain(field);
    }
  });

  it("every non-relation listColumn accessorKey is a real view column", () => {
    const viewCols = parseRelationColumns(orderEntity.viewTable!);
    const customerCol = orderEntity.listColumns.find(
      (c) => c.accessorKey === "customer_name"
    );
    expect(customerCol, "Customer column missing from listColumns").toBeDefined();
    expect(customerCol?.sortable).toBe(true);
    for (const col of orderEntity.listColumns) {
      if (!col.accessorKey || col.relation) continue;
      expect(
        viewCols,
        `listColumn '${col.accessorKey}' missing from view`
      ).toContain(col.accessorKey);
    }
  });

  it("kanban title/cardFields are real view columns (cards read raw fields, no relation resolution)", () => {
    const viewCols = parseRelationColumns(orderEntity.viewTable!);
    const kanban = orderEntity.kanbanConfig!;
    expect(viewCols).toContain(kanban.titleField);
    const cardFieldNames = (kanban.cardFields ?? []).map((f) => f.field);
    expect(cardFieldNames).toContain("customer_name");
    for (const field of cardFieldNames) {
      expect(viewCols, `cardField '${field}' missing from view`).toContain(field);
    }
  });

  it("defaultSort and quickFilter sort columns exist on the view", () => {
    const viewCols = parseRelationColumns(orderEntity.viewTable!);
    expect(viewCols).toContain(orderEntity.defaultSort!.column);
    for (const qf of orderEntity.quickFilters ?? []) {
      if (qf.sort) {
        expect(viewCols, `quickFilter sort '${qf.sort.column}' missing from view`).toContain(
          qf.sort.column
        );
      }
    }
  });
});
