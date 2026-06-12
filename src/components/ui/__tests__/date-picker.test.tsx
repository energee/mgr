/**
 * DatePicker typed-entry tests (C5 audit finding):
 * - parseDateInput accepts flexible formats ("6/15", "2027-08-01", "jun 15")
 *   and rejects garbage / implausible years
 * - the popover panel commits typed dates on Enter, supports Today/Clear
 *   footer buttons, and renders month/year dropdowns (captionLayout="dropdown")
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { format } from "date-fns";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// Radix Popover positioning (floating-ui) needs ResizeObserver; jsdom lacks it.
beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??=
    ResizeObserverStub;
});

import { DatePicker, parseDateInput } from "@/components/ui/date-picker";

// ---------------------------------------------------------------------------
// parseDateInput (pure)
// ---------------------------------------------------------------------------

describe("parseDateInput", () => {
  const ref = new Date(2026, 5, 12); // Jun 12, 2026 — fixed reference year

  it("parses ISO dates", () => {
    expect(format(parseDateInput("2027-08-01", ref)!, "yyyy-MM-dd")).toBe(
      "2027-08-01"
    );
  });

  it("parses US slash dates with and without year", () => {
    expect(format(parseDateInput("6/15/2027", ref)!, "yyyy-MM-dd")).toBe(
      "2027-06-15"
    );
    // Yearless input resolves against the reference year
    expect(format(parseDateInput("6/15", ref)!, "yyyy-MM-dd")).toBe(
      "2026-06-15"
    );
    expect(format(parseDateInput("6/15/27", ref)!, "yyyy-MM-dd")).toBe(
      "2027-06-15"
    );
  });

  it("parses month names case-insensitively, abbreviated and full", () => {
    expect(format(parseDateInput("jun 15", ref)!, "yyyy-MM-dd")).toBe(
      "2026-06-15"
    );
    expect(format(parseDateInput("June 15, 2027", ref)!, "yyyy-MM-dd")).toBe(
      "2027-06-15"
    );
    expect(format(parseDateInput("15 jun 2027", ref)!, "yyyy-MM-dd")).toBe(
      "2027-06-15"
    );
  });

  it("trims and collapses whitespace", () => {
    expect(format(parseDateInput("  jun   15  ", ref)!, "yyyy-MM-dd")).toBe(
      "2026-06-15"
    );
  });

  it("rejects garbage, empty strings, and implausible years", () => {
    expect(parseDateInput("", ref)).toBeUndefined();
    expect(parseDateInput("not a date", ref)).toBeUndefined();
    expect(parseDateInput("13/45/2027", ref)).toBeUndefined();
    expect(parseDateInput("6/15/203", ref)).toBeUndefined(); // year 203 typo
  });
});

// ---------------------------------------------------------------------------
// Component integration (popover panel)
// ---------------------------------------------------------------------------

const commits: (string | undefined)[] = [];

function Harness({ value }: { value?: string }) {
  return (
    <DatePicker
      id="test-date"
      value={value}
      onChange={(v) => {
        commits.push(v);
      }}
    />
  );
}

let container: HTMLDivElement;
let root: Root;

async function render(value?: string) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Harness value={value} />);
  });
  return container.querySelector("button") as HTMLButtonElement;
}

async function openPopover(trigger: HTMLButtonElement) {
  await act(async () => {
    trigger.click();
  });
  // Popover content portals into document.body
  return document.querySelector(
    "[data-slot=popover-content]"
  ) as HTMLElement | null;
}

async function typeText(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )!.set!;
  await act(async () => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function pressEnter(input: HTMLInputElement) {
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
    );
  });
}

function findFooterButton(label: string) {
  return Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent === label
  ) as HTMLButtonElement;
}

describe("DatePicker popover panel", () => {
  beforeEach(() => {
    commits.length = 0;
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it("shows the formatted value on the trigger button", async () => {
    const trigger = await render("2027-08-01");
    expect(trigger.textContent).toContain("August 1st, 2027");
  });

  it("commits a typed date on Enter and closes the popover", async () => {
    const trigger = await render(undefined);
    const content = await openPopover(trigger);
    expect(content).not.toBeNull();

    const input = content!.querySelector("input") as HTMLInputElement;
    expect(input).not.toBeNull();

    await typeText(input, "6/15/2027");
    await pressEnter(input);

    expect(commits).toEqual(["2027-06-15"]);
    expect(document.querySelector("[data-slot=popover-content]")).toBeNull();
  });

  it("flags unparseable typed input instead of committing", async () => {
    const trigger = await render(undefined);
    const content = await openPopover(trigger);
    const input = content!.querySelector("input") as HTMLInputElement;

    await typeText(input, "not a date");
    await pressEnter(input);

    expect(commits).toEqual([]);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    // Popover stays open so the user can correct the text
    expect(document.querySelector("[data-slot=popover-content]")).not.toBeNull();
  });

  it("renders month/year dropdowns (captionLayout='dropdown')", async () => {
    const trigger = await render("2027-08-01");
    const content = await openPopover(trigger);
    const selects = content!.querySelectorAll("select");
    expect(selects.length).toBe(2); // month + year

    // Year range must extend past the current year (future expirations)
    const yearOptions = Array.from(selects[1].options).map((o) => o.value);
    expect(yearOptions).toContain(String(new Date().getFullYear() + 10));
  });

  it("Today button commits today's date", async () => {
    const trigger = await render(undefined);
    await openPopover(trigger);

    await act(async () => {
      findFooterButton("Today").click();
    });

    expect(commits).toEqual([format(new Date(), "yyyy-MM-dd")]);
  });

  it("Clear button commits undefined", async () => {
    const trigger = await render("2027-08-01");
    await openPopover(trigger);

    await act(async () => {
      findFooterButton("Clear").click();
    });

    expect(commits).toEqual([undefined]);
  });
});
