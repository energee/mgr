/**
 * Structural tests for the simplified navigation (spec 2026-07-12).
 * Pins: 2 direct links + 4 sections, unique rooted hrefs, the cut links
 * stay cut, and the floor destinations the mobile tab bar targets exist.
 */
import { describe, expect, it } from "vitest";
import {
  navigation,
  isNavSection,
  type NavItem,
} from "@/components/domain/shared/nav-items";

const flat: NavItem[] = navigation.flatMap((e) =>
  isNavSection(e) ? e.items : [e]
);
const hrefs = flat.map((i) => i.href);

describe("navigation structure", () => {
  it("has exactly 2 direct links and 4 sections, in order", () => {
    const kinds = navigation.map((e) => (isNavSection(e) ? "section" : "link"));
    expect(kinds).toEqual(["link", "section", "section", "section", "section", "link"]);
    expect(navigation.filter(isNavSection).map((s) => s.label)).toEqual([
      "Production", "Inventory", "Purchasing", "Sales",
    ]);
  });

  it("every href is unique and rooted", () => {
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) expect(href).toMatch(/^\//);
  });

  it("cut links stay out of the nav (reachable in-page instead)", () => {
    for (const gone of [
      "/production/planning/backward",
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
      expect(hrefs).not.toContain(gone);
    }
  });

  it("keeps the floor destinations the mobile tab bar targets", () => {
    for (const kept of [
      "/dashboard",
      "/production/batches",
      "/production/packaging",
      "/inventory/items",
      "/sales/pick-lists",
      "/reports",
    ]) {
      expect(hrefs).toContain(kept);
    }
  });

  it("every entry has a label and an icon", () => {
    for (const entry of navigation) {
      expect(entry.label).toBeTruthy();
      expect(entry.icon).toBeTruthy();
      if (isNavSection(entry)) expect(entry.items.length).toBeGreaterThan(0);
    }
  });
});
