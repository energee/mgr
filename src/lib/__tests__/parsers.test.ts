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

import {
  countActiveFilters,
  filterStatesEqual,
  getFiltersStateParser,
  type FilterItemSchema,
} from "@/lib/parsers";

const parse = (filters: unknown[], columnIds = ["name", "status"]) =>
  getFiltersStateParser(columnIds).parse(JSON.stringify(filters));

const NAME_FILTER: FilterItemSchema = {
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

/**
 * `filterStatesEqual` backs the parser's `eq`, used by nuqs to decide whether
 * the current URL state matches the parser's default value. entity-data-table
 * also uses it directly to tell "the URL still holds the entity's default
 * quick-filter preset" apart from "the user changed the filters" — a bare
 * `urlFilters.length > 0` check can't make that distinction once an entity's
 * default preset is itself a non-empty filter array (batch's "Active" quick
 * filter), and conflating them wrongly marks the unfiltered default view as
 * "actively filtered".
 */
describe("filterStatesEqual", () => {
  it("treats two empty arrays as equal", () => {
    expect(filterStatesEqual([], [])).toBe(true);
  });

  it("treats a filter array as equal to an identical default preset", () => {
    const preset = [{ ...NAME_FILTER }];
    expect(
      filterStatesEqual<Record<string, unknown>>([{ ...NAME_FILTER }], preset),
    ).toBe(true);
  });

  it("treats a non-empty filter state as different from an empty default", () => {
    expect(
      filterStatesEqual<Record<string, unknown>>([NAME_FILTER], []),
    ).toBe(false);
  });

  it("treats All-tab empty filters as unequal to a non-empty default preset", () => {
    expect(
      filterStatesEqual<Record<string, unknown>>([], [NAME_FILTER]),
    ).toBe(false);
  });

  it("treats different filter values as different", () => {
    const changed = { ...NAME_FILTER, value: "ipa" };
    expect(
      filterStatesEqual<Record<string, unknown>>([NAME_FILTER], [changed]),
    ).toBe(false);
  });
});

/**
 * `countActiveFilters` backs the mobile filter-sheet trigger's badge count and
 * aria-label (entity-mobile-filter-sheet.tsx via entity-data-table.tsx). It
 * must apply the same "default preset is not an active filter" rule as
 * `hasActiveFilters` — a bare `urlFilters.length` (the pre-fix behavior)
 * shows a "1 active" badge on batch's list on first load, before the user has
 * touched any filter, because batch's default "Active" quick filter is a
 * non-empty preset.
 */
describe("countActiveFilters", () => {
  it("is 0 when there are no filters", () => {
    expect(countActiveFilters<Record<string, unknown>>([])).toBe(0);
  });

  it("is 0 when filters exactly match the default preset", () => {
    expect(
      countActiveFilters<Record<string, unknown>>([NAME_FILTER], [{ ...NAME_FILTER }]),
    ).toBe(0);
  });

  it("counts filters when there is no default preset", () => {
    expect(countActiveFilters<Record<string, unknown>>([NAME_FILTER])).toBe(1);
  });

  it("counts filters that differ from the default preset", () => {
    const changed = { ...NAME_FILTER, value: "ipa" };
    expect(
      countActiveFilters<Record<string, unknown>>([changed], [NAME_FILTER]),
    ).toBe(1);
  });
});
