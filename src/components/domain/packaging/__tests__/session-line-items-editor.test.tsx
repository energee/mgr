// @vitest-environment jsdom
/**
 * Characterization tests for SessionLineItemsEditor.
 *
 * A react-query-backed editor (data via `@/hooks/use-session-line-items`,
 * viewport/pointer via `@/hooks/use-mobile`) whose render logic (loading
 * spinner, empty state, one row per line item, the footer totals, the
 * read-only format-label-with-keg-owner-badge branch, and the mobile
 * card layout swap) was uncovered. This pins that render behavior.
 *
 * Follows the repo's render-test idiom (createRoot + act; no
 * @testing-library/react). The data hook and mobile/touch hooks are mocked
 * with mutable module-level state so each test can drive a different render
 * branch. The row-level child components (`BatchCell`/`FormatCell` from
 * `./packaging-shared`, `AddLineItemRow`) are stubbed to pass-throughs —
 * they pull in their own catalog/combobox dependency graph and are
 * orthogonal to this component's own layout logic — so the test targets
 * only SessionLineItemsEditor's own branching.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { setupRenderHarness } from "@/test/react-harness";
import type { LineItemRow } from "@/hooks/use-session-line-items";

let mockItems: LineItemRow[] | undefined = [];
let mockIsLoading = false;
let mockTotalPlanned = 0;
let mockTotalActual = 0;
let mockKegFormatIds = new Set<string>();
let mockIsMobile = false;
let mockIsTouch = false;

vi.mock("@/hooks/use-session-line-items", () => ({
  useSessionLineItems: () => ({
    items: mockItems,
    isLoading: mockIsLoading,
    totalPlanned: mockTotalPlanned,
    totalActual: mockTotalActual,
  }),
  useLineItemMutations: () => ({
    addItem: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    updateItem: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    deleteItem: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    handleFormatChange: vi.fn(),
    kegFormatIds: mockKegFormatIds,
  }),
  validateNewItem: () => null,
  EMPTY_NEW_ITEM: {
    brand_id: "",
    format_id: "",
    keg_owner_id: "",
    planned_quantity: null,
    actual_quantity: null,
    batch_id: "",
  },
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mockIsMobile,
  useIsTouch: () => mockIsTouch,
}));

vi.mock("../packaging-shared", () => ({
  BatchCell: ({ currentBatchId }: { currentBatchId: string }) => (
    <span data-testid="batch-cell">{currentBatchId || "no-batch"}</span>
  ),
  FormatCell: ({ formatId }: { formatId: string }) => (
    <span data-testid="format-cell">{formatId || "no-format"}</span>
  ),
}));

vi.mock("../add-line-item-row", () => ({
  AddLineItemRow: () => (
    <tr data-testid="add-line-item-row">
      <td>add-row</td>
    </tr>
  ),
}));

import { SessionLineItemsEditor } from "../session-line-items-editor";

const { render } = setupRenderHarness();

afterEach(() => {
  // Reset mock state between tests.
  mockItems = [];
  mockIsLoading = false;
  mockTotalPlanned = 0;
  mockTotalActual = 0;
  mockKegFormatIds = new Set<string>();
  mockIsMobile = false;
  mockIsTouch = false;
});

/** Build a complete line item row; override only what a test cares about. */
const row = (o: Partial<LineItemRow>): LineItemRow => ({
  id: "1",
  brand_id: "b1",
  brand_name: "Test Brand",
  batch_id: null,
  batch_code: null,
  selling_format_id: null,
  selling_format_name: null,
  keg_owner_id: null,
  keg_owner_name: null,
  planned_quantity: null,
  actual_quantity: null,
  ...o,
});

describe("SessionLineItemsEditor", () => {
  it("shows a loading spinner and nothing else while items are loading", () => {
    mockIsLoading = true;
    const c = render(<SessionLineItemsEditor sessionId="s1" />);
    expect(c.querySelector(".animate-spin")).not.toBeNull();
    expect(c.textContent?.trim()).toBe("");
  });

  it("shows an empty state (single message row, no footer) when there are no line items", () => {
    mockItems = [];
    const c = render(<SessionLineItemsEditor sessionId="s1" />);
    expect(c.textContent).toContain("No line items yet");
    expect(c.querySelectorAll("tbody tr").length).toBe(1);
    expect(c.querySelector("tfoot")).toBeNull();
  });

  it("renders one row per line item with the brand name and stubbed batch/format cells", () => {
    mockItems = [
      row({ id: "1", brand_name: "Hazy IPA" }),
      row({ id: "2", brand_name: "Stout" }),
    ];
    const c = render(<SessionLineItemsEditor sessionId="s1" />);
    expect(c.querySelectorAll("tbody tr").length).toBe(2);
    expect(c.textContent).toContain("Hazy IPA");
    expect(c.textContent).toContain("Stout");
    expect(c.querySelectorAll('[data-testid="batch-cell"]').length).toBe(2);
    expect(c.querySelectorAll('[data-testid="format-cell"]').length).toBe(2);
    expect(c.querySelectorAll('[aria-label="Remove line item"]').length).toBe(2);
  });

  it("totals planned/actual quantities in the footer", () => {
    mockItems = [row({ id: "1" }), row({ id: "2" })];
    mockTotalPlanned = 42;
    mockTotalActual = 37;
    const c = render(<SessionLineItemsEditor sessionId="s1" />);
    const footer = c.querySelector("tfoot");
    expect(footer?.textContent).toContain("Totals");
    expect(footer?.textContent).toContain("42");
    expect(footer?.textContent).toContain("37");
  });

  it("read-only format cell shows the format name with a keg-owner badge, or falls back to an em-dash", () => {
    mockKegFormatIds = new Set(["keg-format"]);
    mockItems = [
      row({
        id: "1",
        selling_format_id: "keg-format",
        selling_format_name: "1/2 BBL Keg",
        keg_owner_name: "ACME Kegs",
      }),
      row({ id: "2", selling_format_name: null }),
    ];
    const c = render(<SessionLineItemsEditor sessionId="s1" readOnly />);
    expect(c.textContent).toContain("1/2 BBL Keg");
    expect(c.textContent).toContain("ACME Kegs");
    // No format-cell stub is rendered in read-only mode (raw label + badge instead).
    expect(c.querySelector('[data-testid="format-cell"]')).toBeNull();
    // No delete affordance in read-only mode.
    expect(c.querySelector('[aria-label="Remove line item"]')).toBeNull();
    const rows = c.querySelectorAll("tbody tr");
    expect(rows[1]?.textContent).toContain("—");
  });

  it("renders a stacked card layout instead of a table on mobile", () => {
    mockIsMobile = true;
    mockItems = [row({ id: "1", brand_name: "Pilsner" })];
    const c = render(<SessionLineItemsEditor sessionId="s1" />);
    expect(c.querySelector("table")).toBeNull();
    expect(c.textContent).toContain("Pilsner");
    expect(c.textContent).toContain("Planned Qty");
    expect(c.textContent).toContain("Actual Qty");
  });
});
