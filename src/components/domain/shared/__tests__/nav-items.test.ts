/**
 * Structural tests for the simplified navigation (spec 2026-07-12).
 * Pins: 2 direct links + 4 sections, unique rooted hrefs, the cut links
 * stay cut, the 2.0 D3 freeze-list stays frozen out, and the floor
 * destinations the mobile tab bar targets exist.
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

  // 2.0 streamlining node D3: these features keep their code, routes and
  // migrations but are deliberately not advertised in the primary nav. None
  // was ever present here, so this pins the status quo against re-addition
  // rather than recording a removal. Prefix-matched so a sub-route can't
  // sneak back in under a frozen root.
  it("keeps the D3 freeze-list out of the nav", () => {
    for (const frozen of [
      "/settings/integrations", // QuickBooks, Slack, beer-orders XLSX, MongoDB
      "/inventory/kegs/owners", // keg owner records
      "/inventory/kegs/reports", // deposits-outstanding money math
    ]) {
      for (const href of hrefs) {
        expect(
          href === frozen || href.startsWith(frozen + "/"),
          `${href} must stay out of the nav (frozen root ${frozen})`
        ).toBe(false);
      }
    }
  });

  // Square POS and pick lists are explicitly NOT part of the freeze: Square is
  // a retained integration, and pick-list completion transitions allocations.
  // Keg FILL identity lives under /inventory/kegs/transactions and is live, so
  // only the owner/deposit routes above are frozen.
  it("keeps keg transactions reachable via the Kegs nav entry", () => {
    expect(hrefs).toContain("/inventory/kegs");
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
