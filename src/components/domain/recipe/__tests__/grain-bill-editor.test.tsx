// @vitest-environment jsdom
/**
 * Characterization tests for GrainBillEditor.
 *
 * A controlled editor ({ items, onChange }) whose render logic (empty state,
 * one row per item, malt-name binding via the joined `malt` field, the
 * weight/percentage/total footer, and the base-malt-percentage /
 * zero-weight warnings) was uncovered. This pins that render behavior ahead
 * of any future shared-editor-shell refactor.
 *
 * Follows the repo's render-test idiom (createRoot + act; no
 * @testing-library/react). The dnd-kit `Sortable` wrapper is stubbed to
 * pass-throughs (orthogonal drag chrome), `useCatalog` is mocked to an
 * empty/idle result so the malt-selector popover's catalog data is
 * deterministic (rows use the joined `item.malt` data instead), and the
 * weight-unit hook is mocked — so the test targets the editor's own layout
 * logic.
 */

import { describe, it, expect, vi } from "vitest";
import { setupRenderHarness } from "@/test/react-harness";
import type { GrainBillItem } from "../grain-bill-editor";

vi.mock("@/hooks/use-unit-preferences", () => ({
  useWeightUnit: () => "lbs",
}));
vi.mock("@/hooks/use-catalog", () => ({
  useCatalog: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/components/ui/sortable", () => ({
  Sortable: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SortableContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SortableItem: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SortableItemHandle: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SortableOverlay: () => null,
}));

import { GrainBillEditor } from "../grain-bill-editor";

const { render } = setupRenderHarness();

const noop = () => {};

const baseMalt = {
  id: "m1",
  name: "Maris Otter",
  maltster: "Crisp",
  type: "base",
  color_lovibond: 3,
  potential_ppg: 37,
  bag_weight_lbs: 55,
};

const specialtyMalt = {
  id: "m2",
  name: "Crystal 60",
  maltster: "Briess",
  type: "specialty",
  color_lovibond: 60,
  potential_ppg: 34,
  bag_weight_lbs: 55,
};

describe("GrainBillEditor", () => {
  it("shows an empty state (and no table) when there are no items", () => {
    const c = render(<GrainBillEditor items={[]} onChange={noop} />);
    expect(c.textContent).toContain("No malts added yet.");
    expect(c.textContent).toContain("Add Malt");
    expect(c.querySelector("table")).toBeNull();
  });

  it("renders one row per item with the malt name and weight bound to an input", () => {
    const items: GrainBillItem[] = [
      { id: "i1", malt_id: "m1", weight_lbs: 8, position: 0, malt: baseMalt },
      { id: "i2", malt_id: "m2", weight_lbs: 2, position: 1, malt: specialtyMalt },
    ];
    const c = render(<GrainBillEditor items={items} onChange={noop} />);
    expect(c.querySelectorAll("tbody tr").length).toBe(2);
    expect(c.textContent).toContain("Maris Otter");
    expect(c.textContent).toContain("Crystal 60");
    const weightInputs = Array.from(
      c.querySelectorAll('tbody input[type="number"]')
    ) as HTMLInputElement[];
    expect(weightInputs.map((i) => i.value)).toEqual(["8", "2"]);
  });

  it("totals weight and computes each row's percentage in the footer/columns", () => {
    const items: GrainBillItem[] = [
      { id: "i1", malt_id: "m1", weight_lbs: 8, position: 0, malt: baseMalt },
      { id: "i2", malt_id: "m2", weight_lbs: 2, position: 1, malt: specialtyMalt },
    ];
    const c = render(<GrainBillEditor items={items} onChange={noop} />);
    const footer = c.querySelector("tfoot");
    expect(footer?.textContent).toContain("Total");
    expect(footer?.textContent).toContain("10.00 lbs");
    expect(footer?.textContent).toContain("100%");
    expect(c.textContent).toContain("80.0%"); // base malt row's percentage
    expect(c.textContent).toContain("20.0%"); // specialty malt row's percentage
  });

  it("falls back to 'Unknown' when a row has no joined malt and it isn't in the catalog", () => {
    const items: GrainBillItem[] = [
      { id: "i1", malt_id: "missing", weight_lbs: 5, position: 0 },
    ];
    const c = render(<GrainBillEditor items={items} onChange={noop} />);
    expect(c.textContent).toContain("Unknown");
  });

  it("warns when base malt share is under 70% and when items have no weight", () => {
    const items: GrainBillItem[] = [
      { id: "i1", malt_id: "m1", weight_lbs: 4, position: 0, malt: baseMalt },
      { id: "i2", malt_id: "m2", weight_lbs: 6, position: 1, malt: specialtyMalt },
      { id: "i3", malt_id: "m3", weight_lbs: 0, position: 2 },
    ];
    const c = render(<GrainBillEditor items={items} onChange={noop} />);
    expect(c.textContent).toContain("Base malt is only 40.0% of grain bill");
    expect(c.textContent).toContain("1 item(s) have no weight specified.");
  });

  it("shows no warnings when base malt share is high and all items have weight", () => {
    const items: GrainBillItem[] = [
      { id: "i1", malt_id: "m1", weight_lbs: 9, position: 0, malt: baseMalt },
      { id: "i2", malt_id: "m2", weight_lbs: 1, position: 1, malt: specialtyMalt },
    ];
    const c = render(<GrainBillEditor items={items} onChange={noop} />);
    expect(c.textContent).not.toContain("Base malt is only");
    expect(c.textContent).not.toContain("no weight specified");
  });
});
