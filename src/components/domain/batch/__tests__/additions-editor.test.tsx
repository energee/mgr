// @vitest-environment jsdom
/**
 * Characterization tests for AdditionsEditor.
 *
 * A controlled editor ({ items, onChange }) whose render logic (empty state,
 * one row per addition with the amount bound to an input, the additive-type
 * badge label map with a raw fallback, the conditional Target column, and the
 * footer's pluralized addition count) was uncovered. This pins that render
 * behavior.
 *
 * Follows the repo's render-test idiom (createRoot + act; no
 * @testing-library/react). `useCatalog` is mocked to an empty-safe value
 * (all rows here carry an inline `additive`, so no catalog lookup is
 * required), and the dnd-kit `Sortable` wrapper is stubbed to pass-throughs
 * (orthogonal drag chrome; avoids jsdom ResizeObserver gaps) so the test
 * targets the editor's own layout logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { setupRenderHarness } from "@/test/react-harness";
import { click, setInputValue } from "@/test/dom-events";
import type { AdditionItem } from "../additions-editor";

// Captures the Sortable's reorder callback, the per-row Select onValueChange
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

import { AdditionsEditor } from "../additions-editor";

const { render } = setupRenderHarness();

beforeEach(() => {
  captured.reorder = undefined;
  captured.selects = [];
  captured.catalog = [];
});

const noop = () => {};

/** Build a complete addition item; override only what a test cares about. */
const item = (o: Partial<AdditionItem>): AdditionItem => ({
  additive_id: "x",
  amount: 1,
  unit: "g",
  timing: "boil",
  position: 0,
  additive: { id: "x", name: "X", type: "other", description: null, typical_amount: null, typical_unit: null },
  ...o,
});

const inputValues = (c: HTMLElement) =>
  Array.from(c.querySelectorAll("input")).map((i) => (i as HTMLInputElement).value);

describe("AdditionsEditor", () => {
  it("shows an empty state (and no table) when there are no items", () => {
    const c = render(<AdditionsEditor items={[]} onChange={noop} />);
    expect(c.textContent).toContain("No additions added yet.");
    expect(c.textContent).toContain("Add Addition");
    expect(c.querySelector("table")).toBeNull();
  });

  it("renders one row per addition with the amount bound to an input", () => {
    const items: AdditionItem[] = [
      item({ additive_id: "a1", amount: 5, additive: { id: "a1", name: "Whirlfloc", type: "clarifier", description: null, typical_amount: null, typical_unit: null } }),
      item({ additive_id: "a2", amount: 2.5, additive: { id: "a2", name: "Yeast Nutrient", type: "nutrient", description: null, typical_amount: null, typical_unit: null } }),
    ];
    const c = render(<AdditionsEditor items={items} onChange={noop} />);
    expect(c.querySelectorAll("tbody tr").length).toBe(2);
    expect(c.textContent).toContain("Whirlfloc");
    expect(c.textContent).toContain("Yeast Nutrient");
    const values = inputValues(c);
    expect(values).toContain("5");
    expect(values).toContain("2.5");
  });

  it("maps additive type to a badge label, with a raw fallback for unmapped types", () => {
    const items: AdditionItem[] = [
      item({
        additive_id: "a1",
        additive: { id: "a1", name: "Whirlfloc", type: "clarifier", description: null, typical_amount: null, typical_unit: null },
      }),
      item({
        additive_id: "a2",
        additive: { id: "a2", name: "Something Weird", type: "mystery", description: null, typical_amount: null, typical_unit: null },
      }),
    ];
    const c = render(<AdditionsEditor items={items} onChange={noop} />);
    expect(c.textContent).toContain("Clarifiers"); // TYPE_LABELS.clarifier
    expect(c.textContent).toContain("mystery"); // raw fallback for unmapped type
  });

  it("falls back to 'Unknown' when the additive is missing", () => {
    const c = render(
      <AdditionsEditor items={[item({ additive_id: "missing", additive: undefined })]} onChange={noop} />,
    );
    expect(c.textContent).toContain("Unknown");
  });

  it("shows an em-dash Target cell for non-water-chemistry additives", () => {
    const c = render(
      <AdditionsEditor
        items={[
          item({
            additive_id: "a1",
            additive: { id: "a1", name: "Whirlfloc", type: "clarifier", description: null, typical_amount: null, typical_unit: null },
          }),
        ]}
        onChange={noop}
      />,
    );
    const lastCell = c.querySelector("tbody tr")?.querySelectorAll("td")[5];
    expect(lastCell?.textContent).toBe("—");
  });

  it("shows a pluralized addition count in the footer", () => {
    const one = render(<AdditionsEditor items={[item({})]} onChange={noop} />);
    expect(one.querySelector("tfoot")?.textContent).toContain("1 addition");
    expect(one.querySelector("tfoot")?.textContent).not.toContain("1 additions");

    // render() self-cleans (unmounts the prior tree) before mounting the next.
    const two = render(
      <AdditionsEditor items={[item({ additive_id: "a1" }), item({ additive_id: "a2" })]} onChange={noop} />,
    );
    expect(two.querySelector("tfoot")?.textContent).toContain("2 additions");
  });

  describe("interactions", () => {
    const whirlfloc = {
      id: "a1",
      name: "Whirlfloc",
      type: "clarifier",
      description: null,
      typical_amount: null,
      typical_unit: null,
    };
    const nutrient = {
      id: "a2",
      name: "Yeast Nutrient",
      type: "nutrient",
      description: null,
      typical_amount: 5,
      typical_unit: "g",
    };
    const gypsum = {
      id: "a3",
      name: "Gypsum",
      type: "water_salt",
      description: null,
      typical_amount: 2,
      typical_unit: "g",
    };

    const twoItems = (): AdditionItem[] => [
      item({ additive_id: "a1", amount: 1, additive: whirlfloc }),
      item({ additive_id: "a2", amount: 5, unit: "g", timing: "fermentation", position: 1, additive: nutrient }),
    ];

    it("adds a catalog additive at the end with type-derived timing/unit defaults", () => {
      captured.catalog = [nutrient];
      const onChange = vi.fn();
      const c = render(
        <AdditionsEditor items={[item({ additive_id: "a1", additive: whirlfloc })]} onChange={onChange} />,
      );
      click(c.querySelector('[data-testid="cmd-item"]'));
      expect(onChange).toHaveBeenCalledTimes(1);
      const updated = onChange.mock.calls[0][0] as AdditionItem[];
      expect(updated).toHaveLength(2);
      expect(updated[0].additive_id).toBe("a1");
      expect(updated[1]).toMatchObject({
        additive_id: "a2",
        amount: 5, // typical_amount
        unit: "g", // typical_unit
        timing: "fermentation", // nutrient default
        target: undefined, // not water chemistry
        position: 1,
        additive: nutrient,
      });
    });

    it("gives a water-chemistry additive a mash timing and a mash target", () => {
      captured.catalog = [gypsum];
      const onChange = vi.fn();
      const c = render(<AdditionsEditor items={[]} onChange={onChange} />);
      click(c.querySelector('[data-testid="cmd-item"]'));
      const updated = onChange.mock.calls[0][0] as AdditionItem[];
      expect(updated[0]).toMatchObject({
        additive_id: "a3",
        timing: "mash",
        target: "mash",
        position: 0,
      });
    });

    it("removes a row and renumbers remaining positions", () => {
      const onChange = vi.fn();
      const c = render(<AdditionsEditor items={twoItems()} onChange={onChange} />);
      const firstRowButtons = c.querySelectorAll("tbody tr")[0].querySelectorAll("button");
      click(firstRowButtons[firstRowButtons.length - 1]);
      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ additive_id: "a2", position: 0 }),
      ]);
    });

    it("persists a reorder with renumbered positions", () => {
      const onChange = vi.fn();
      const items = twoItems();
      render(<AdditionsEditor items={items} onChange={onChange} />);
      act(() => captured.reorder!([items[1], items[0]]));
      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ additive_id: "a2", position: 0 }),
        expect.objectContaining({ additive_id: "a1", position: 1 }),
      ]);
    });

    it("propagates an amount edit and a timing change for the right row", () => {
      const onChange = vi.fn();
      const c = render(<AdditionsEditor items={twoItems()} onChange={onChange} />);
      const amountInput = c
        .querySelectorAll("tbody tr")[1]
        .querySelector('input[type="number"]') as HTMLInputElement;
      setInputValue(amountInput, "3.5");
      const updated = onChange.mock.calls[0][0] as AdditionItem[];
      expect(updated[1]).toMatchObject({ additive_id: "a2", amount: 3.5 });
      expect(updated[0]).toMatchObject({ additive_id: "a1", amount: 1 });

      // Per row the Selects are [unit, timing] (Target only renders for water chemistry),
      // so row 0's timing handler is index 1.
      act(() => captured.selects[1]("whirlpool"));
      expect((onChange.mock.calls[1][0] as AdditionItem[])[0]).toMatchObject({
        additive_id: "a1",
        timing: "whirlpool",
      });
    });
  });
});
