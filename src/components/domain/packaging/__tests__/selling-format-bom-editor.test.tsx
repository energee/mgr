// @vitest-environment jsdom
/**
 * Characterization tests for SellingFormatBOMEditor.
 *
 * The only line-item editor of the family without coverage before the shared
 * <LineItemsEditor> refactor. Pins its render + commit behavior: the empty
 * state, the row-per-material table, the QtyEditor branch (whole-unit "X per
 * Y" ratio inputs vs single decimal input), commit-on-blur semantics for
 * quantity (invalid/zero/unchanged input does NOT write), notes-on-blur
 * normalization (trimmed, "" -> null), and immediate delete.
 *
 * Follows the repo's render-test idiom (createRoot + act; no
 * @testing-library/react). `@/lib/supabase/client` is mocked (env validation
 * at import time) and `@tanstack/react-query` is mocked so all three
 * mutations share one recorded `mutate` spy — calls are told apart by
 * argument shape (insert: InventoryItem, update: {id, updates}, delete:
 * string id). BOM data comes through a mocked `useSellingFormatBOM`.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { act } from "react";
import { setupRenderHarness } from "@/test/react-harness";
import type { SellingFormatMaterial } from "@/hooks/use-material-planning";

const h = vi.hoisted(() => ({
  bom: [] as unknown[],
  bomLoading: false,
  inventoryItems: [] as unknown[],
  mutate: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

vi.mock("@tanstack/react-query", () => ({
  // Single useQuery in the component: the inventory-items picker list.
  useQuery: () => ({ data: h.inventoryItems, isLoading: false, isPending: false }),
  useMutation: () => ({ mutate: h.mutate, mutateAsync: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/hooks/use-material-planning", () => ({
  useSellingFormatBOM: () => ({ data: h.bom, isLoading: h.bomLoading }),
}));

import { SellingFormatBOMEditor } from "../selling-format-bom-editor";

const { render } = setupRenderHarness();

beforeEach(() => {
  h.bom = [];
  h.bomLoading = false;
  h.inventoryItems = [];
  h.mutate.mockReset();
});

const material = (
  o: Partial<SellingFormatMaterial> & Pick<SellingFormatMaterial, "id">,
): SellingFormatMaterial => ({
  selling_format_id: "sf1",
  inventory_item_id: "item-1",
  quantity_per_unit: 1,
  notes: null,
  inventory_item: {
    id: "item-1",
    name: "Crown Cap",
    sku: null,
    category: "Packaging",
    unit: "lb",
  },
  ...o,
});

/** Set a controlled input's value through the native setter + input event. */
function typeValue(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function blur(input: HTMLInputElement) {
  act(() => {
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

const qtyInput = (c: HTMLElement) =>
  c.querySelector<HTMLInputElement>('[aria-label="Quantity per unit"]')!;

describe("SellingFormatBOMEditor", () => {
  it("shows the empty state (no table) when the BOM has no materials", () => {
    const c = render(<SellingFormatBOMEditor sellingFormatId="sf1" />);
    expect(c.textContent).toContain("No materials defined yet.");
    expect(c.textContent).toContain("Add Material");
    expect(c.querySelector("table")).toBeNull();
  });

  it("renders one row per material with name, category, unit, and notes", () => {
    h.bom = [
      material({ id: "m1", notes: "glued on" }),
      material({
        id: "m2",
        inventory_item_id: "item-2",
        inventory_item: {
          id: "item-2",
          name: "Label Roll",
          sku: null,
          category: "Labels",
          unit: "roll",
        },
      }),
    ];
    const c = render(<SellingFormatBOMEditor sellingFormatId="sf1" />);
    expect(c.querySelectorAll("tbody tr").length).toBe(2);
    expect(c.textContent).toContain("Crown Cap");
    expect(c.textContent).toContain("Packaging");
    expect(c.textContent).toContain("Label Roll");
    expect(c.textContent).toContain("roll");
    const notes = Array.from(
      c.querySelectorAll<HTMLInputElement>('input[type="text"]'),
    ).map((i) => i.value);
    expect(notes).toEqual(["glued on", ""]);
  });

  it("falls back to the raw inventory_item_id when the joined item is missing", () => {
    h.bom = [material({ id: "m1", inventory_item: null })];
    const c = render(<SellingFormatBOMEditor sellingFormatId="sf1" />);
    expect(c.textContent).toContain("item-1");
    // Unit column falls back to an em-dash.
    expect(c.textContent).toContain("—");
  });

  it("renders 'X per Y' integer inputs for whole units with a clean ratio", () => {
    h.bom = [
      material({
        id: "m1",
        quantity_per_unit: 0.25,
        inventory_item: {
          id: "item-1",
          name: "Tray",
          sku: null,
          category: null,
          unit: "each",
        },
      }),
    ];
    const c = render(<SellingFormatBOMEditor sellingFormatId="sf1" />);
    const num = c.querySelector<HTMLInputElement>('[aria-label="Quantity per pack"]')!;
    const den = c.querySelector<HTMLInputElement>('[aria-label="Pack size"]')!;
    expect(num.value).toBe("1");
    expect(den.value).toBe("4");
    expect(c.querySelector('[aria-label="Quantity per unit"]')).toBeNull();
  });

  it("renders a single decimal input for bulk units", () => {
    h.bom = [material({ id: "m1", quantity_per_unit: 0.125 })];
    const c = render(<SellingFormatBOMEditor sellingFormatId="sf1" />);
    expect(qtyInput(c).value).toBe("0.125");
    expect(c.querySelector('[aria-label="Quantity per pack"]')).toBeNull();
  });

  it("commits a changed decimal quantity on blur", () => {
    h.bom = [material({ id: "m1", quantity_per_unit: 1 })];
    const c = render(<SellingFormatBOMEditor sellingFormatId="sf1" />);
    typeValue(qtyInput(c), "2.5");
    blur(qtyInput(c));
    expect(h.mutate).toHaveBeenCalledTimes(1);
    expect(h.mutate).toHaveBeenCalledWith({
      id: "m1",
      updates: { quantity_per_unit: 2.5 },
    });
  });

  it("does not write on blur for zero, invalid, or unchanged quantities", () => {
    h.bom = [material({ id: "m1", quantity_per_unit: 1 })];
    const c = render(<SellingFormatBOMEditor sellingFormatId="sf1" />);
    typeValue(qtyInput(c), "0");
    blur(qtyInput(c));
    typeValue(qtyInput(c), "");
    blur(qtyInput(c));
    typeValue(qtyInput(c), "1");
    blur(qtyInput(c));
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it("commits a ratio quantity as numerator/denominator on blur of either field", () => {
    h.bom = [
      material({
        id: "m1",
        quantity_per_unit: 0.25,
        inventory_item: {
          id: "item-1",
          name: "Tray",
          sku: null,
          category: null,
          unit: "each",
        },
      }),
    ];
    const c = render(<SellingFormatBOMEditor sellingFormatId="sf1" />);
    const den = c.querySelector<HTMLInputElement>('[aria-label="Pack size"]')!;
    typeValue(den, "8");
    blur(den);
    expect(h.mutate).toHaveBeenCalledWith({
      id: "m1",
      updates: { quantity_per_unit: 0.125 },
    });
  });

  it("normalizes notes on blur (trimmed; empty commits null; unchanged skips)", () => {
    h.bom = [material({ id: "m1", notes: "old note" })];
    const c = render(<SellingFormatBOMEditor sellingFormatId="sf1" />);
    const notes = c.querySelector<HTMLInputElement>('input[type="text"]')!;
    typeValue(notes, "  new note  ");
    blur(notes);
    expect(h.mutate).toHaveBeenCalledWith({
      id: "m1",
      updates: { notes: "new note" },
    });
    h.mutate.mockClear();
    typeValue(notes, "   ");
    blur(notes);
    expect(h.mutate).toHaveBeenCalledWith({ id: "m1", updates: { notes: null } });
  });

  it("deletes a material immediately on the row's trash button", () => {
    h.bom = [material({ id: "m1" })];
    const c = render(<SellingFormatBOMEditor sellingFormatId="sf1" />);
    const buttons = Array.from(c.querySelectorAll("tbody button"));
    const trash = buttons[buttons.length - 1] as HTMLButtonElement;
    act(() => trash.click());
    expect(h.mutate).toHaveBeenCalledWith("m1");
  });

  it("disables row controls and the Add Material button when disabled", () => {
    h.bom = [material({ id: "m1" })];
    const c = render(<SellingFormatBOMEditor sellingFormatId="sf1" disabled />);
    const controls = [
      ...Array.from(c.querySelectorAll<HTMLInputElement>("input")),
      ...Array.from(c.querySelectorAll<HTMLButtonElement>("button")),
    ];
    expect(controls.length).toBeGreaterThan(0);
    for (const el of controls) expect(el.disabled).toBe(true);
  });
});
