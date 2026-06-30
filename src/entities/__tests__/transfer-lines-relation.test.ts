/**
 * Location Transfer "Lines" Relation Contract Test
 *
 * The transfer_lines relation points at "transfer_line", which is NOT a
 * registered entity — the generic RelationTable would render a "Related
 * entity not found" error card and transfers would dead-end after header
 * creation (no UI anywhere else can insert transfer_lines rows, so Ship
 * stays permanently disabled).
 *
 * The fix mounts TransferLinesEditor as the relation's custom component
 * (entity-detail-unified.tsx renders rel.component instead of RelationTable).
 * The structural checks in entity-configs.test.ts deliberately skip
 * component-backed / hideAdd relations, so this test pins the wiring:
 * if someone removes the component, the broken-tab regression returns
 * without any other test failing.
 */

import { describe, it, expect, vi } from "vitest";

// Mock the Supabase client to avoid env var requirements during import
// (the entity config imports TransferLinesEditor, which imports the client).
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ data: [], error: null }),
    }),
  }),
}));

import { locationTransferEntity } from "@/entities/location-transfer";

describe("location_transfer 'Lines' relation", () => {
  const linesRelation = locationTransferEntity.relations?.find(
    (rel) => rel.name === "transfer_lines"
  );

  it("is a hasMany relation on transfer_id shown as a detail tab", () => {
    expect(linesRelation).toBeDefined();
    expect(linesRelation?.type).toBe("hasMany");
    expect(linesRelation?.foreignKey).toBe("transfer_id");
    expect(linesRelation?.showInDetail).toBe(true);
    expect(linesRelation?.detailTab).toBe("Lines");
  });

  it("mounts a custom component (transfer_line is unregistered — the generic RelationTable cannot render it)", () => {
    expect(linesRelation?.component).toBeDefined();
    expect(typeof linesRelation?.component).toBe("function");
  });

  it("suppresses the generic Add link (no /inventory/transfer-lines/new route exists)", () => {
    expect(linesRelation?.hideAdd).toBe(true);
  });
});
