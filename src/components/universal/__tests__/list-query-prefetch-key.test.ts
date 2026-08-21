/**
 * Server prefetch ↔ client first-render key parity for list queries.
 *
 * The sitewide loading pattern only works when the key a server component
 * prefetches (defaultListParams → listQueryKey) is identical to the key the
 * client computes on first render. The batches page regressed on this for a
 * month: the prefetch fetched the unfiltered first page while the client's
 * default "Active" quick filter swapped the key, discarding the prefetched
 * payload on every default visit (2026-08-21 loading audit). Both sides now
 * consume quickFilterColumnFilters + the entity core, which these tests pin.
 */
import { describe, expect, it, vi } from "vitest";

// list-query-options → data-table/adapter → ui/unit-input →
// use-unit-preferences → supabase/client, whose module-level env validation
// throws under vitest. Mock the leaf (repo test idiom).
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

import {
  defaultListParams,
  listQueryKey,
  quickFilterColumnFilters,
} from "../list-query-options";
import { batchCore } from "@/entities/batch/core";

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

  it("produces the same query key regardless of filterId (excluded from the key)", () => {
    const params = defaultListParams(batchCore, { hasOnAction: true });
    // The client's tab-click path generates random filterIds; the parser
    // default uses stable ones. The key must not depend on them.
    const preset = batchCore.quickFilters!.find((qf) => qf.isDefault)!;
    const clientFilters = quickFilterColumnFilters(preset, (i) => `client-${i}`);

    expect(listQueryKey({ ...params, urlFilters: clientFilters })).toEqual(
      listQueryKey(params)
    );
  });

  it("leaves urlFilters empty for entities without a default quick filter", () => {
    const params = defaultListParams({ table: "brands" });
    expect(params.urlFilters).toEqual([]);
  });

  it("mirrors a default preset's sort override into the server ORDER BY", () => {
    const params = defaultListParams({
      table: "things",
      defaultSort: { column: "created_at", direction: "desc" },
      quickFilters: [
        {
          label: "Open",
          filters: [{ column: "status", values: ["open"] }],
          isDefault: true,
          sort: { column: "due_date", direction: "asc" },
        },
      ],
    });
    expect(params.order[0]).toEqual({ column: "due_date", ascending: true });
  });
});
