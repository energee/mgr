// @vitest-environment jsdom
/**
 * Characterization tests for HopScheduleEditor.
 *
 * A controlled editor ({ items, onChange }) that also reads the hop catalog
 * via `useCatalog` (react-query + Supabase) — that hook is mocked to a
 * benign empty result since these tests only exercise rows whose `hop` is
 * already joined inline on the item, never the "Add Hop" search popover.
 * Pins the empty state, per-row field bindings (weight in lbs, derived from
 * canonical `weight_oz`), the footer totals (weight via `UnitDisplay`, IBU
 * via the real Tinseth formula), the non-boil `TIMING_DISPLAY` fallback
 * text, and the timing legend that only renders once hops are present.
 *
 * Follows the repo's render-test idiom (createRoot + act; no
 * @testing-library/react). `Sortable` is stubbed to pass-throughs,
 * `UnitDisplay` to a plain `<span>`, and `useCatalog` to an empty,
 * not-loading result — so the test targets the editor's own layout logic.
 */

import { describe, it, expect, vi } from "vitest";
import { setupRenderHarness } from "@/test/react-harness";
import type { HopScheduleItem } from "../hop-schedule-editor";
import { getHopUtilizationFactor } from "@/domain/recipe-estimate-calc";

vi.mock("@/hooks/use-catalog", () => ({
  useCatalog: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/components/ui/unit-input", () => ({
  UnitDisplay: ({ value, unitType }: { value: number | null | undefined; unitType: string }) => (
    <span>{value == null ? "—" : `${value} ${unitType}`}</span>
  ),
}));
vi.mock("@/components/ui/sortable", () => ({
  Sortable: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SortableContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SortableItem: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SortableItemHandle: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SortableOverlay: () => null,
}));

import { HopScheduleEditor } from "../hop-schedule-editor";

const { render } = setupRenderHarness();

const noop = () => {};

/** Last number input per row is always the weight (lbs) field, whether or not a boil-time input also renders. */
const weightInputValues = (c: HTMLElement) =>
  Array.from(c.querySelectorAll("tbody tr")).map((tr) => {
    const inputs = tr.querySelectorAll('input[type="number"]');
    return (inputs[inputs.length - 1] as HTMLInputElement).value;
  });

const cascade: HopScheduleItem["hop"] = {
  id: "hop1",
  name: "Cascade",
  origin: "US",
  type: "aroma",
  alpha_acid_typical: 5.5,
  flavor_profile: "Citrus",
  bag_weight_lbs: null,
};

const citra: HopScheduleItem["hop"] = {
  id: "hop2",
  name: "Citra",
  origin: "US",
  type: "aroma",
  alpha_acid_typical: 12,
  flavor_profile: "Tropical",
  bag_weight_lbs: null,
};

describe("HopScheduleEditor", () => {
  it("shows an empty state (and no table) when there are no hops", () => {
    const c = render(<HopScheduleEditor items={[]} onChange={noop} />);
    expect(c.textContent).toContain("No hops added yet.");
    expect(c.textContent).toContain("Add Hop");
    expect(c.querySelector("tbody")).toBeNull();
  });

  it("renders one row per hop addition with the weight (lbs) field bound to the item", () => {
    const items: HopScheduleItem[] = [
      { id: "h1", hop_id: "hop1", weight_oz: 16, timing: "boil", boil_time_min: 60, position: 0, hop: cascade },
      { id: "h2", hop_id: "hop2", weight_oz: 32, timing: "dry_hop", boil_time_min: null, position: 1, hop: citra },
    ];
    const c = render(<HopScheduleEditor items={items} onChange={noop} />);
    expect(c.querySelectorAll("tbody tr").length).toBe(2);
    expect(c.textContent).toContain("Cascade");
    expect(c.textContent).toContain("Citra");
    expect(weightInputValues(c)).toEqual(["1", "2"]);
  });

  it("totals hop weight (via UnitDisplay) and IBU (Tinseth) in the footer", () => {
    const items: HopScheduleItem[] = [
      { id: "h1", hop_id: "hop1", weight_oz: 48, timing: "boil", boil_time_min: 60, position: 0, hop: cascade },
    ];
    const c = render(<HopScheduleEditor items={items} onChange={noop} />);
    const footer = c.querySelector("tfoot");
    expect(footer?.textContent).toContain("Total");
    // 48 oz / 16 oz-per-lb = 3 lbs, rendered by the mocked UnitDisplay.
    expect(footer?.textContent).toContain("3 weight");

    const utilization = getHopUtilizationFactor("boil", 60, 1.05);
    const aau = 48 * (cascade!.alpha_acid_typical as number);
    const expectedIBU = ((aau * utilization * 74.89) / 5).toFixed(0);
    expect(footer?.textContent).toContain(`${expectedIBU} IBU`);
  });

  it("shows the non-boil TIMING_DISPLAY fallback text instead of a boil-time input", () => {
    const items: HopScheduleItem[] = [
      { id: "h1", hop_id: "hop1", weight_oz: 16, timing: "first_wort", boil_time_min: null, position: 0, hop: cascade },
      { id: "h2", hop_id: "hop2", weight_oz: 16, timing: "whirlpool", boil_time_min: null, position: 1, hop: citra },
      { id: "h3", hop_id: "hop2", weight_oz: 16, timing: "dry_hop", boil_time_min: null, position: 2, hop: citra },
    ];
    const c = render(<HopScheduleEditor items={items} onChange={noop} />);
    expect(c.textContent).toContain("60 min");
    expect(c.textContent).toContain("0 min");
    expect(c.textContent).toContain("—");
    // None of these rows are "boil", so no boil-time <input> should render (only the weight input per row).
    expect(c.querySelectorAll('input[type="number"]').length).toBe(3);
  });

  it("shows the hop-timing legend only when hops are present", () => {
    const withHops = render(
      <HopScheduleEditor
        items={[{ id: "h1", hop_id: "hop1", weight_oz: 16, timing: "boil", boil_time_min: 60, position: 0, hop: cascade }]}
        onChange={noop}
      />,
    );
    expect(withHops.textContent).toContain("Added during lautering");
    expect(withHops.textContent).toContain("Added during fermentation");
    // render() self-cleans (unmounts the prior tree) before mounting the next.
    const empty = render(<HopScheduleEditor items={[]} onChange={noop} />);
    expect(empty.textContent).not.toContain("Added during lautering");
  });
});
