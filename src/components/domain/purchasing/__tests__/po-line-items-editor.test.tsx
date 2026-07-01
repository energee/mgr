// @vitest-environment jsdom
/**
 * Characterization tests for POLineItemsEditor.
 *
 * A Supabase/react-query-backed inline editor ({ poId, readOnly }) whose render
 * logic (the loading spinner early-return, the "Line Items" table shell, the
 * empty-state row, the one-row-per-line-item body with catalog-type label +
 * resolved name + price/line-total formatting, the `getCatalogTypeLabel` raw
 * fallback, and the Subtotal footer that only appears with rows) was uncovered.
 * This pins that render behavior ahead of the shared line-item-editor refactor.
 *
 * Follows the repo's render-test idiom (createRoot + act; no
 * @testing-library/react). `@/lib/supabase/client` is mocked (its real module
 * runs env validation at import time) and `@tanstack/react-query` is mocked so
 * `useQuery` reads from a hoisted, mutable fixture keyed on the query key — the
 * queryFn never runs, so no real network/Supabase calls occur. Row assertions
 * use `readOnly` so radix Select/Combobox/Input never render (readOnly cells are
 * plain text), keeping the render deterministic in jsdom.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// Hoisted, mutable fixture the mocked useQuery reads from. Using vi.hoisted so
// the mock factory (hoisted above imports) can safely close over it.
const fixture = vi.hoisted(() => ({
  lineItems: { data: [], isLoading: false, isPending: false } as {
    data: unknown;
    isLoading: boolean;
    isPending: boolean;
  },
}));

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: readonly unknown[] }) => {
    const key = Array.isArray(options.queryKey) ? options.queryKey[0] : undefined;
    if (key === "po-line-items") return fixture.lineItems;
    // catalog-items lookup (only used by the add-row combobox) — benign.
    return { data: [], isLoading: false, isPending: false };
  },
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import { POLineItemsEditor } from "../po-line-items-editor";

type Row = {
  id: string;
  catalog_type: string;
  catalog_id: string;
  catalog_name: string;
  quantity: number;
  unit: string;
  unit_price: number | null;
};

function setLineItems(data: Row[] | undefined, isLoading = false) {
  fixture.lineItems = { data, isLoading, isPending: false };
}

let root: Root | null = null;
let container: HTMLElement | null = null;

function render(el: ReactElement): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(el));
  return container;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  setLineItems([]);
});

describe("POLineItemsEditor", () => {
  it("renders a spinner and no table while line items are loading", () => {
    setLineItems(undefined, true);
    const c = render(<POLineItemsEditor poId="po-1" />);
    expect(c.querySelector(".animate-spin")).not.toBeNull();
    expect(c.textContent).not.toContain("Line Items");
    expect(c.querySelector("table")).toBeNull();
  });

  it("shows the empty state (and no footer) when there are no line items", () => {
    setLineItems([]);
    const c = render(<POLineItemsEditor poId="po-1" readOnly />);
    expect(c.textContent).toContain("Line Items");
    expect(c.textContent).toContain("No line items yet");
    expect(c.querySelector("tfoot")).toBeNull();
  });

  it("shows the Add Item button in the empty state when editable", () => {
    setLineItems([]);
    const c = render(<POLineItemsEditor poId="po-1" />);
    expect(c.textContent).toContain("Add Item");
    expect(c.textContent).toContain("No line items yet");
  });

  it("renders one row per line item with type label, name, unit price and null fallback", () => {
    setLineItems([
      {
        id: "l1",
        catalog_type: "malt",
        catalog_id: "m1",
        catalog_name: "Pilsner Malt",
        quantity: 10,
        unit: "lb",
        unit_price: 2.5,
      },
      {
        id: "l2",
        catalog_type: "hop",
        catalog_id: "h1",
        catalog_name: "Cascade",
        quantity: 5,
        unit: "oz",
        unit_price: null,
      },
    ]);
    const c = render(<POLineItemsEditor poId="po-1" readOnly />);
    expect(c.querySelectorAll("tbody tr").length).toBe(2);
    // catalog-type labels resolved via getCatalogTypeLabel
    expect(c.textContent).toContain("Malt");
    expect(c.textContent).toContain("Hop");
    // resolved catalog names
    expect(c.textContent).toContain("Pilsner Malt");
    expect(c.textContent).toContain("Cascade");
    // formatted unit price and the null-price em-dash fallback
    expect(c.textContent).toContain("$2.50");
    expect(c.textContent).toContain("—");
  });

  it("totals only priced rows in the Subtotal footer", () => {
    setLineItems([
      {
        id: "l1",
        catalog_type: "malt",
        catalog_id: "m1",
        catalog_name: "Pilsner Malt",
        quantity: 10,
        unit: "lb",
        unit_price: 2.5,
      },
      {
        id: "l2",
        catalog_type: "hop",
        catalog_id: "h1",
        catalog_name: "Cascade",
        quantity: 5,
        unit: "oz",
        unit_price: null,
      },
    ]);
    const c = render(<POLineItemsEditor poId="po-1" readOnly />);
    const footer = c.querySelector("tfoot");
    expect(footer?.textContent).toContain("Subtotal");
    // 10 * 2.5 + 5 * 0 = 25.00
    expect(footer?.textContent).toContain("$25.00");
  });

  it("falls back to the raw catalog_type when it has no known label", () => {
    setLineItems([
      {
        id: "l1",
        catalog_type: "widget",
        catalog_id: "w1",
        catalog_name: "Mystery Widget",
        quantity: 1,
        unit: "ea",
        unit_price: 3,
      },
    ]);
    const c = render(<POLineItemsEditor poId="po-1" readOnly />);
    expect(c.textContent).toContain("widget");
    expect(c.textContent).toContain("Mystery Widget");
  });
});
