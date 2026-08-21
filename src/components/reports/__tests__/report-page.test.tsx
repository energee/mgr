// @vitest-environment jsdom
/**
 * Rendering contract for the shared report scaffold
 * (src/components/reports/report-page.tsx).
 *
 * The five report pages under src/app/(app)/reports/ were migrated onto this
 * scaffold as a behavior-preserving refactor. The summary math that moved out
 * of those pages is covered by src/domain/__tests__/report-summaries.test.ts, but
 * the larger half of that diff was JSX moving into these components — and a
 * green lint/typecheck/build proves nothing about column headers, empty
 * states, expand rows, or label association.
 *
 * These tests pin the parts of the contract the pages depend on, including
 * the specific regressions found reviewing the migration: the `htmlFor`
 * association on ReportField, and the summary-card title only becoming a flex
 * row when there is actually an icon to sit beside the label.
 *
 * Repo idiom: createRoot + act via src/test/react-harness (no
 * @testing-library/react in this repo).
 */

import { describe, it, expect, vi } from "vitest";
import { setupRenderHarness } from "@/test/react-harness";

// next/link needs an app router context we don't have here; a plain anchor
// preserves everything these tests assert about the header.
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

import {
  ReportPage,
  ReportField,
  ReportSummaryCards,
  ReportTable,
  ReportTableCard,
  ReportTableState,
} from "../report-page";

const { render } = setupRenderHarness();

const texts = (el: HTMLElement, selector: string) =>
  Array.from(el.querySelectorAll(selector)).map((n) => n.textContent?.trim());

// =============================================================================
// ReportPage
// =============================================================================

describe("ReportPage", () => {
  it("renders the heading, description and back-link to /reports", () => {
    const el = render(
      <ReportPage title="Batch Cost" description="Ingredient cost per batch">
        <p>body</p>
      </ReportPage>
    );
    expect(el.querySelector("h1")?.textContent).toBe("Batch Cost");
    expect(el.textContent).toContain("Ingredient cost per batch");
    expect(el.querySelector("a")?.getAttribute("href")).toBe("/reports");
  });

  it("shows no error alert and no note when neither is supplied", () => {
    const el = render(
      <ReportPage title="T" description="d">
        <p>body</p>
      </ReportPage>
    );
    expect(el.textContent).not.toContain("Error Loading Report");
    expect(el.textContent).not.toContain("Note:");
  });

  it("surfaces an Error's message, and the fallback for a non-Error", () => {
    const withError = render(
      <ReportPage title="T" description="d" error={new Error("boom")}>
        <p>body</p>
      </ReportPage>
    );
    expect(withError.textContent).toContain("Error Loading Report");
    expect(withError.textContent).toContain("boom");

    const withString = render(
      <ReportPage
        title="T"
        description="d"
        error="not-an-error"
        errorFallback="Failed to load report data"
      >
        <p>body</p>
      </ReportPage>
    );
    expect(withString.textContent).toContain("Failed to load report data");
  });

  it("renders the filter node and the disclaimer note when supplied", () => {
    const el = render(
      <ReportPage
        title="T"
        description="d"
        filter={<div data-testid="filter">filter-here</div>}
        note="Costs exclude labor."
      >
        <p>body</p>
      </ReportPage>
    );
    expect(el.querySelector("[data-testid=filter]")?.textContent).toBe(
      "filter-here"
    );
    expect(el.textContent).toContain("Note:");
    expect(el.textContent).toContain("Costs exclude labor.");
  });
});

// =============================================================================
// ReportField — label/control association
// =============================================================================

describe("ReportField", () => {
  it("associates the label with the control via htmlFor", () => {
    // Regression guard: the scaffold migration initially dropped this, which
    // broke click-to-focus and the accessible name on the inventory-valuation
    // as-of-date input.
    const el = render(
      <ReportField label="As of" htmlFor="as-of-date">
        <input id="as-of-date" type="date" readOnly />
      </ReportField>
    );
    const label = el.querySelector("label");
    expect(label?.getAttribute("for")).toBe("as-of-date");
    expect(label?.textContent).toBe("As of");
  });

  it("omits the for attribute when the control is not a form element", () => {
    const el = render(
      <ReportField label="Granularity">
        <button type="button">Monthly</button>
      </ReportField>
    );
    expect(el.querySelector("label")?.hasAttribute("for")).toBe(false);
  });
});

// =============================================================================
// ReportSummaryCards
// =============================================================================

describe("ReportSummaryCards", () => {
  const cards = [
    { label: "Total Cost", value: <span>$1,234.00</span> },
    { label: "Batches", value: <span>7</span> },
  ];

  it("renders skeletons instead of values while loading", () => {
    const el = render(<ReportSummaryCards cards={cards} loading />);
    expect(el.textContent).not.toContain("$1,234.00");
    expect(el.querySelectorAll("[data-slot=skeleton]").length).toBe(2);
  });

  it("renders values and captions when loaded", () => {
    const el = render(
      <ReportSummaryCards
        cards={[{ ...cards[0], sub: <span>per batch</span> }, cards[1]]}
        loading={false}
      />
    );
    expect(el.textContent).toContain("$1,234.00");
    expect(el.textContent).toContain("per batch");
    expect(el.querySelectorAll("[data-slot=skeleton]").length).toBe(0);
  });

  it("only makes the title a flex row when the card has an icon", () => {
    // Pins the pre-scaffold markup: icon-less cards (production-summary) kept
    // a plain title, so the scaffold must not add flex classes unconditionally.
    const Icon = (props: { className?: string }) => <svg {...props} />;
    const el = render(
      <ReportSummaryCards
        cards={[
          { label: "No icon", value: <span>1</span> },
          { label: "With icon", value: <span>2</span>, icon: Icon as never },
        ]}
        loading={false}
      />
    );
    const titles = Array.from(el.querySelectorAll("[data-slot=card-title]"));
    expect(titles).toHaveLength(2);
    expect(titles[0].className).not.toContain("flex");
    expect(titles[1].className).toContain("flex");
    expect(titles[1].querySelector("svg")).not.toBeNull();
  });
});

// =============================================================================
// ReportTableState / ReportTableCard — loading vs empty vs content precedence
// =============================================================================

describe("ReportTableState", () => {
  it("prefers loading over the empty state", () => {
    const el = render(
      <ReportTableState loading isEmpty emptyMessage="No rows">
        <p>content</p>
      </ReportTableState>
    );
    expect(el.textContent).not.toContain("No rows");
    expect(el.textContent).not.toContain("content");
    // Kit ListSkeleton: 5 default rows × 5 default columns
    expect(el.querySelectorAll("[data-slot=skeleton]").length).toBe(25);
  });

  it("prefers the empty state over content", () => {
    const el = render(
      <ReportTableState loading={false} isEmpty emptyMessage="No rows">
        <p>content</p>
      </ReportTableState>
    );
    expect(el.textContent).toContain("No rows");
    expect(el.textContent).not.toContain("content");
  });

  it("renders content when loaded and non-empty", () => {
    const el = render(
      <ReportTableState loading={false} isEmpty={false} emptyMessage="No rows">
        <p>content</p>
      </ReportTableState>
    );
    expect(el.textContent).toContain("content");
  });

  it("honours a custom skeleton row count", () => {
    const el = render(
      <ReportTableState loading skeletonRows={3} isEmpty emptyMessage="No rows">
        <p>content</p>
      </ReportTableState>
    );
    // 3 requested rows × 5 default kit columns
    expect(el.querySelectorAll("[data-slot=skeleton]").length).toBe(15);
  });
});

describe("ReportTableCard", () => {
  it("renders title, description and a footer alongside the table", () => {
    const el = render(
      <ReportTableCard
        title="Cost by Batch"
        description="Ingredient cost per packaged batch"
        loading={false}
        isEmpty={false}
        emptyMessage="No batches"
        footer={<p>* estimated</p>}
      >
        <p>table</p>
      </ReportTableCard>
    );
    expect(el.textContent).toContain("Cost by Batch");
    expect(el.textContent).toContain("Ingredient cost per packaged batch");
    expect(el.textContent).toContain("table");
    expect(el.textContent).toContain("* estimated");
  });

  it("keeps the footer visible while the table area is empty", () => {
    // The pages render caveat text outside the loading/empty switch; the
    // scaffold's footer slot must preserve that placement.
    const el = render(
      <ReportTableCard
        loading={false}
        isEmpty
        emptyMessage="No batches"
        footer={<p>* estimated</p>}
      >
        <p>table</p>
      </ReportTableCard>
    );
    expect(el.textContent).toContain("No batches");
    expect(el.textContent).not.toContain("table");
    expect(el.textContent).toContain("* estimated");
  });
});

// =============================================================================
// ReportTable
// =============================================================================

type Row = { id: string; name: string; cost: number; shortfall: number };

const rows: Row[] = [
  { id: "b1", name: "Hazy IPA", cost: 1234.5, shortfall: 0 },
  { id: "b2", name: "Pilsner", cost: 987.25, shortfall: -12 },
];

const columns = [
  { header: "Batch", cell: (r: Row) => r.name },
  {
    header: "Cost",
    headClassName: "text-right",
    cellClassName: "text-right font-mono",
    cell: (r: Row) => `$${r.cost.toFixed(2)}`,
  },
  {
    header: "Shortfall",
    cellClassName: (r: Row) => (r.shortfall < 0 ? "text-destructive" : ""),
    cell: (r: Row) => r.shortfall,
  },
];

describe("ReportTable", () => {
  it("renders the configured column headers in order", () => {
    const el = render(
      <ReportTable columns={columns} rows={rows} rowKey={(r) => r.id} />
    );
    expect(texts(el, "thead th")).toEqual(["Batch", "Cost", "Shortfall"]);
    expect(el.querySelectorAll("thead th")[1].className).toContain(
      "text-right"
    );
  });

  it("renders one row per record with formatted cells", () => {
    const el = render(
      <ReportTable columns={columns} rows={rows} rowKey={(r) => r.id} />
    );
    const bodyRows = el.querySelectorAll("tbody tr");
    expect(bodyRows).toHaveLength(2);
    expect(texts(el, "tbody tr:first-child td")).toEqual([
      "Hazy IPA",
      "$1234.50",
      "0",
    ]);
  });

  it("applies a per-row cellClassName function", () => {
    const el = render(
      <ReportTable columns={columns} rows={rows} rowKey={(r) => r.id} />
    );
    const bodyRows = el.querySelectorAll("tbody tr");
    // Only the negative-shortfall row gets the destructive class.
    expect(bodyRows[0].querySelectorAll("td")[2].className).not.toContain(
      "text-destructive"
    );
    expect(bodyRows[1].querySelectorAll("td")[2].className).toContain(
      "text-destructive"
    );
  });

  it("invokes onRowClick with the clicked row", () => {
    const onRowClick = vi.fn();
    const el = render(
      <ReportTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={onRowClick}
      />
    );
    (el.querySelectorAll("tbody tr")[1] as HTMLElement).click();
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick.mock.calls[0][0]).toMatchObject({ id: "b2" });
  });

  it("renders extra rows before and after a data row, plus a footer", () => {
    const el = render(
      <ReportTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        renderBeforeRow={(r) =>
          r.id === "b1" ? (
            <tr data-testid="group">
              <td colSpan={3}>Group header</td>
            </tr>
          ) : null
        }
        renderAfterRow={(r) =>
          r.id === "b1" ? (
            <tr data-testid="detail">
              <td colSpan={3}>Expanded detail</td>
            </tr>
          ) : null
        }
        footer={
          <tr data-testid="footer">
            <td colSpan={3}>Total</td>
          </tr>
        }
      />
    );
    // group header, b1, detail, b2, footer
    expect(el.querySelectorAll("tbody tr")).toHaveLength(5);
    expect(texts(el, "tbody tr")).toEqual([
      "Group header",
      "Hazy IPA$1234.500",
      "Expanded detail",
      "Pilsner$987.25-12",
      "Total",
    ]);
    expect(
      el.querySelector("[data-testid=detail] td")?.getAttribute("colspan")
    ).toBe("3");
  });

  it("renders nothing in the body for an empty row list", () => {
    const el = render(
      <ReportTable columns={columns} rows={[]} rowKey={(r) => r.id} />
    );
    expect(el.querySelectorAll("tbody tr")).toHaveLength(0);
    expect(texts(el, "thead th")).toEqual(["Batch", "Cost", "Shortfall"]);
  });
});
