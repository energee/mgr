/**
 * URL-state parser tests (src/lib/parsers.ts).
 *
 * Focus: `getFiltersStateParser` must degrade PER FILTER, not per URL. The
 * `variant`/`operator` vocabularies in `dataTableConfig` shrink over time (the
 * numeric/range variants and `isRelativeToToday` were removed), so a saved or
 * bookmarked list URL can legitimately carry a filter this build no longer
 * understands — dropping the whole array would silently wipe the user's other,
 * still-valid filters with no indication.
 */

import { describe, it, expect } from "vitest";

import { getFiltersStateParser } from "@/lib/parsers";

const parse = (filters: unknown[], columnIds = ["name", "status"]) =>
  getFiltersStateParser(columnIds).parse(JSON.stringify(filters));

const NAME_FILTER = {
  id: "name",
  value: "stout",
  variant: "text",
  operator: "iLike",
  filterId: "f1",
};

describe("getFiltersStateParser", () => {
  it("keeps valid filters", () => {
    expect(parse([NAME_FILTER])).toEqual([NAME_FILTER]);
  });

  it("drops a filter with a retired variant and keeps the rest", () => {
    const stale = { ...NAME_FILTER, id: "status", variant: "number", filterId: "f2" };
    expect(parse([NAME_FILTER, stale])).toEqual([NAME_FILTER]);
  });

  it("drops a filter with a retired operator and keeps the rest", () => {
    const stale = {
      ...NAME_FILTER,
      id: "status",
      variant: "date",
      operator: "isRelativeToToday",
      filterId: "f2",
    };
    expect(parse([NAME_FILTER, stale])).toEqual([NAME_FILTER]);
  });

  it("drops a filter naming a column this table does not have", () => {
    const gone = { ...NAME_FILTER, id: "removed_column", filterId: "f2" };
    expect(parse([NAME_FILTER, gone])).toEqual([NAME_FILTER]);
  });

  it("returns null for a non-array or unparseable value", () => {
    const parser = getFiltersStateParser(["name"]);
    expect(parser.parse(JSON.stringify({ id: "name" }))).toBeNull();
    expect(parser.parse("not json")).toBeNull();
  });
});
