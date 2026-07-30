/**
 * TTBReportCaveats tests (issue #618).
 *
 * The component exists so both TTB report summary cards — the `get_ttb_report`
 * table and the legacy batch-volume fallback — carry the same honesty notes.
 * These cases pin the contract the fallback card was missing: the in-process
 * snapshot caveat always renders (with the period named), the identity
 * disclosure renders only when there is something to disclose, and the
 * Total-column scope note (issue #670) renders only on the card that has a Total
 * column.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

import { TTBReportCaveats } from "@/components/reports/ttb-report-caveats";
import { getInProcessSnapshotCaveat, PACKAGED_TOTAL_MARKER } from "@/domain/ttb-utils";

/**
 * Stand-in for whatever `getTotalScopeCaveat` returns. The component's contract
 * is "render the string you were handed, or nothing" — pinning the real wording
 * here would duplicate the assertions in the ttb-utils suite that own it.
 */
const TOTAL_SCOPE_CAVEAT = `${PACKAGED_TOTAL_MARKER} Total on the marked lines covers the packaged tax classes only.`;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(ui: React.ReactElement) {
  act(() => root.render(ui));
}

function paragraphs(): string[] {
  return Array.from(container.querySelectorAll("p")).map((p) => p.textContent ?? "");
}

describe("TTBReportCaveats", () => {
  it("renders the snapshot caveat naming the period, plus the disclosure", () => {
    render(
      <TTBReportCaveats
        periodLabel="June 2026"
        identityDisclosure="Not accounting-identity checked: Cellar (In-Process) (because reasons)."
      />
    );
    const text = paragraphs();
    expect(text).toHaveLength(2);
    expect(text[0]).toBe(getInProcessSnapshotCaveat("June 2026"));
    expect(text[0]).toContain("not a balance as of the end of June 2026");
    expect(text[1]).toContain("Not accounting-identity checked:");
  });

  it("renders the caveat alone when nothing needs disclosing", () => {
    render(<TTBReportCaveats periodLabel="June 2026" identityDisclosure={null} />);
    const text = paragraphs();
    expect(text).toHaveLength(1);
    expect(text[0]).toContain("snapshot of batches");
    expect(container.textContent).not.toContain("Not accounting-identity checked");
  });

  it("never shows an internal tracker reference to the compliance officer", () => {
    render(<TTBReportCaveats periodLabel="June 2026" identityDisclosure={null} />);
    expect(container.textContent).not.toContain("#618");
  });

  it("renders what the Total column covers when given it (issue #670)", () => {
    render(
      <TTBReportCaveats
        periodLabel="June 2026"
        identityDisclosure={null}
        totalColumnCaveat={TOTAL_SCOPE_CAVEAT}
      />
    );
    const text = paragraphs();
    expect(text).toHaveLength(2);
    expect(text[1]).toBe(TOTAL_SCOPE_CAVEAT);
    expect(container.textContent).not.toContain("#670");
  });

  it("omits the Total-column note when it was not given one", () => {
    // Two callers omit it: the legacy fallback card, a two-column table with no
    // Total column at all, and the by-tax-class card on a report where nothing
    // is scoped out (getTotalScopeCaveat returns null). Explaining a scope that
    // does not apply would be worse than saying nothing.
    render(<TTBReportCaveats periodLabel="June 2026" identityDisclosure={null} />);
    expect(container.textContent).not.toContain(PACKAGED_TOTAL_MARKER);
    expect(paragraphs()).toHaveLength(1);
  });
});
