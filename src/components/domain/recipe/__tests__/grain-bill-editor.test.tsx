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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { setupRenderHarness } from "@/test/react-harness";
import { click, setInputValue } from "@/test/dom-events";
import type { GrainBillItem } from "../grain-bill-editor";

// Captures the Sortable's reorder callback and the mocked catalog data so
// interaction tests can drive reordering and the add-from-catalog popover.
const captured = vi.hoisted(() => ({
  reorder: undefined as ((items: unknown[]) => void) | undefined,
  catalog: [] as unknown[],
}));

vi.mock("@/hooks/use-unit-preferences", () => ({
  useResolvedUnitPreferences: () => ({ weight_unit: "lbs" }),
}));
vi.mock("@/hooks/use-catalog", () => ({
  useCatalog: () => ({ data: captured.catalog, isLoading: false }),
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

import { GrainBillEditor } from "../grain-bill-editor";

beforeEach(() => {
  captured.reorder = undefined;
  captured.catalog = [];
});

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

  describe("interactions", () => {
    const twoItems = (): GrainBillItem[] => [
      { id: "i1", malt_id: "m1", weight_lbs: 8, position: 0, malt: baseMalt },
      { id: "i2", malt_id: "m2", weight_lbs: 2, position: 1, malt: specialtyMalt },
    ];

    it("adds a catalog malt as a new zero-weight item at the end", () => {
      captured.catalog = [baseMalt];
      const onChange = vi.fn();
      const c = render(<GrainBillEditor items={[]} onChange={onChange} />);
      click(c.querySelector('[data-testid="cmd-item"]'));
      expect(onChange).toHaveBeenCalledTimes(1);
      const added = onChange.mock.calls[0][0] as GrainBillItem[];
      expect(added).toHaveLength(1);
      expect(added[0]).toMatchObject({
        malt_id: "m1",
        weight_lbs: 0,
        position: 0,
        malt: baseMalt,
      });
      expect(added[0].id).toBeTruthy();
    });

    it("hides already-added malts from the add selector", () => {
      captured.catalog = [baseMalt, specialtyMalt];
      const c = render(
        <GrainBillEditor
          items={[{ id: "i1", malt_id: "m1", weight_lbs: 8, position: 0, malt: baseMalt }]}
          onChange={vi.fn()}
        />,
      );
      const options = Array.from(c.querySelectorAll('[data-testid="cmd-item"]'));
      expect(options).toHaveLength(1);
      expect(options[0].textContent).toContain("Crystal 60");
    });

    it("removes a row and renumbers remaining positions", () => {
      const onChange = vi.fn();
      const c = render(<GrainBillEditor items={twoItems()} onChange={onChange} />);
      const firstRowButtons = c.querySelectorAll("tbody tr")[0].querySelectorAll("button");
      click(firstRowButtons[firstRowButtons.length - 1]);
      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ id: "i2", position: 0 }),
      ]);
    });

    it("propagates a weight edit for the right row", () => {
      const onChange = vi.fn();
      const c = render(<GrainBillEditor items={twoItems()} onChange={onChange} />);
      const weightInput = c
        .querySelectorAll("tbody tr")[1]
        .querySelector('input[type="number"]') as HTMLInputElement;
      setInputValue(weightInput, "3.5");
      const updated = onChange.mock.calls[0][0] as GrainBillItem[];
      expect(updated[1]).toMatchObject({ id: "i2", weight_lbs: 3.5 });
      expect(updated[0]).toMatchObject({ id: "i1", weight_lbs: 8 });
    });

    it("persists a reorder with renumbered positions", () => {
      const onChange = vi.fn();
      const items = twoItems();
      render(<GrainBillEditor items={items} onChange={onChange} />);
      act(() => captured.reorder!([items[1], items[0]]));
      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ id: "i2", position: 0 }),
        expect.objectContaining({ id: "i1", position: 1 }),
      ]);
    });
  });
});
