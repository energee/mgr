/**
 * Server prefetch ↔ client first-render key parity for list queries.
 *
 * The sitewide loading pattern only works when the key a server component
 * prefetches (defaultListParams → listQueryKey) is byte-identical to the key
 * the client computes on first render. The batches page regressed on this for
 * a month: the prefetch fetched the unfiltered first page while the client's
 * default "Active" quick filter immediately swapped the key, discarding the
 * prefetched payload on every default visit (2026-08-21 loading audit).
 */
import { describe, expect, it, vi } from "vitest";

// list-query-options → data-table/adapter → ui/unit-input →
// use-unit-preferences → supabase/client, whose module-level env validation
// throws under vitest. Mock the leaf (repo test idiom).
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

import { defaultListParams, listQueryKey } from "../list-query-options";
import type { ExtendedColumnFilter } from "@/types/data-table";
import { batchCore } from "@/entities/batch/core";
import { DEFAULT_PAGE_SIZE } from "@/hooks/use-persisted-page-size";

describe("defaultListParams prefetch key parity", () => {
  it("applies the entity's default quick filter to the prefetch params", () => {
    const params = defaultListParams(batchCore, { hasOnAction: true });
    expect(params.urlFilters).toEqual([
      expect.objectContaining({
        id: "status",
        operator: "inArray",
        value: ["fermenting", "conditioning", "packaging"],
      }),
    ]);
  });

  it("produces the same query key as the client's first render (filterId/variant excluded)", () => {
    const params = defaultListParams(batchCore, { hasOnAction: true });
    // Mirror the client's effectiveUrlFilters mapping (entity-data-table.tsx)
    // with deliberately different filterIds — the key must not depend on them.
    const preset = batchCore.quickFilters!.find((qf) => qf.isDefault)!;
    const clientFilters = preset.filters.map((f, i) => ({
      id: f.column,
      value: f.values,
      variant: "multiSelect",
      operator: "inArray",
      filterId: `client-${i}`,
    })) as ExtendedColumnFilter<Record<string, unknown>>[];

    expect(listQueryKey({ ...params, urlFilters: clientFilters })).toEqual(
      listQueryKey(params)
    );
  });

  it("leaves urlFilters empty for entities without a default quick filter", () => {
    const params = defaultListParams({ table: "brands" });
    expect(params.urlFilters).toEqual([]);
  });

  it("prefetches the client's default page size (drift guard)", () => {
    // defaultListParams can't import DEFAULT_PAGE_SIZE (a "use client"
    // module); its literal fell out of sync once (10 vs 25), silently missing
    // the hydration key on every prefetch.
    const params = defaultListParams({ table: "brands" });
    expect(params.to).toBe(DEFAULT_PAGE_SIZE - 1);
  });
});
