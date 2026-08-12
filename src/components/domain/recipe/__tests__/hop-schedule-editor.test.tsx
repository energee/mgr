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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { setupRenderHarness } from "@/test/react-harness";
import { click, setInputValue } from "@/test/dom-events";
import type { HopScheduleItem } from "../hop-schedule-editor";
import { getHopUtilizationFactor } from "@/domain/recipe-estimate-calc";

// Captures the Sortable's reorder callback, per-row Select onValueChange
// handlers (in render order), and the mocked catalog data for interactions.
const captured = vi.hoisted(() => ({
  reorder: undefined as ((items: unknown[]) => void) | undefined,
  selects: [] as ((value: string) => void)[],
  catalog: [] as unknown[],
}));

vi.mock("@/hooks/use-catalog", () => ({
  useCatalog: () => ({ data: captured.catalog, isLoading: false }),
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    onValueChange,
  }: {
    children: React.ReactNode;
    onValueChange?: (value: string) => void;
  }) => {
    if (onValueChange) captured.selects.push(onValueChange);
    return <div>{children}</div>;
  },
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
}));
// Radix popover + cmdk stubs: render inline so the add-from-catalog list is
// reachable without portal/pointer plumbing; CommandItem becomes a button.
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/command", () => ({
  Command: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandInput: () => null,
  CommandList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandEmpty: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandGroup: ({ children, heading }: { children: React.ReactNode; heading?: React.ReactNode }) => (
    <div>
      <span>{heading}</span>
      {children}
    </div>
  ),
  CommandItem: ({ children, onSelect }: { children: React.ReactNode; onSelect?: () => void }) => (
    <button type="button" data-testid="cmd-item" onClick={() => onSelect?.()}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ui/unit-input", () => ({
  UnitDisplay: ({ value, unitType }: { value: number | null | undefined; unitType: string }) => (
    <span>{value == null ? "—" : `${value} ${unitType}`}</span>
  ),
}));
vi.mock("@/components/ui/sortable", () => ({
  Sortable: ({
    children,
    onValueChange,
  }: {
    children: React.ReactNode;
    onValueChange?: (items: unknown[]) => void;
  }) => {
    captured.reorder = onValueChange;
    return <>{children}</>;
  },
  SortableContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SortableItem: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SortableItemHandle: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SortableOverlay: () => null,
}));

import { HopScheduleEditor } from "../hop-schedule-editor";

const { render } = setupRenderHarness();

beforeEach(() => {
  captured.reorder = undefined;
  captured.selects = [];
  captured.catalog = [];
});

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

  describe("interactions", () => {
    const twoItems = (): HopScheduleItem[] => [
      { id: "h1", hop_id: "hop1", weight_oz: 16, timing: "boil", boil_time_min: 60, position: 0, hop: cascade },
      { id: "h2", hop_id: "hop2", weight_oz: 32, timing: "dry_hop", boil_time_min: null, position: 1, hop: citra },
    ];

    it("adds a catalog hop with boil/60min defaults at the end", () => {
      captured.catalog = [cascade];
      const onChange = vi.fn();
      const c = render(<HopScheduleEditor items={twoItems()} onChange={onChange} />);
      click(c.querySelector('[data-testid="cmd-item"]'));
      const added = onChange.mock.calls[0][0] as HopScheduleItem[];
      expect(added).toHaveLength(3);
      expect(added[2]).toMatchObject({
        hop_id: "hop1",
        weight_oz: 0,
        timing: "boil",
        boil_time_min: 60,
        position: 2,
        hop: cascade,
      });
      expect(added[2].id).toBeTruthy();
    });

    it("removes a row and renumbers remaining positions", () => {
      const onChange = vi.fn();
      const c = render(<HopScheduleEditor items={twoItems()} onChange={onChange} />);
      const firstRowButtons = c.querySelectorAll("tbody tr")[0].querySelectorAll("button");
      click(firstRowButtons[firstRowButtons.length - 1]);
      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ id: "h2", position: 0 }),
      ]);
    });

    it("stores a weight edit in canonical oz (input is lbs)", () => {
      const onChange = vi.fn();
      const c = render(<HopScheduleEditor items={twoItems()} onChange={onChange} />);
      const row0Inputs = c.querySelectorAll("tbody tr")[0].querySelectorAll('input[type="number"]');
      setInputValue(row0Inputs[row0Inputs.length - 1] as HTMLInputElement, "2");
      const updated = onChange.mock.calls[0][0] as HopScheduleItem[];
      expect(updated[0]).toMatchObject({ id: "h1", weight_oz: 32 });
    });

    it("nulls boil time when timing leaves the boil, and restores 60 when returning", () => {
      const onChange = vi.fn();
      render(<HopScheduleEditor items={twoItems()} onChange={onChange} />);
      // Row 0 (boil, 60 min) -> dry_hop clears boil_time_min.
      act(() => captured.selects[0]("dry_hop"));
      expect((onChange.mock.calls[0][0] as HopScheduleItem[])[0]).toMatchObject({
        timing: "dry_hop",
        boil_time_min: null,
      });
      // Row 1 (dry_hop, null) -> boil defaults boil_time_min to 60.
      act(() => captured.selects[1]("boil"));
      expect((onChange.mock.calls[1][0] as HopScheduleItem[])[1]).toMatchObject({
        timing: "boil",
        boil_time_min: 60,
      });
    });

    it("persists a reorder with renumbered positions", () => {
      const onChange = vi.fn();
      const items = twoItems();
      render(<HopScheduleEditor items={items} onChange={onChange} />);
      act(() => captured.reorder!([items[1], items[0]]));
      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ id: "h2", position: 0 }),
        expect.objectContaining({ id: "h1", position: 1 }),
      ]);
    });
  });
});
