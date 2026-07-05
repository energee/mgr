/**
 * FieldInput number-case tests (U1 audit finding): typing "-" or "." must
 * never render "NaN", in-progress decimals ("1.", "7.7530") must survive
 * controlled re-renders, and the display resyncs from the form value only
 * while unfocused (blur / external change such as form.reset). Also covers
 * the unit-case fallback used when a field has type "unit" but no unitType.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, useEffect, useState } from "react";
import { setupRenderHarness } from "@/test/react-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// Prevents env-var validation in @/lib/env from throwing at import time
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

// Prevents @sentry/nextjs initialisation errors in jsdom
vi.mock("@/lib/client-logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { FieldInput } from "@/components/universal/field-input";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const commits: unknown[] = [];
let setExternalValue: (v: unknown) => void;

function Harness({ type, unitType }: { type: string; unitType?: undefined }) {
  const [value, setValue] = useState<unknown>(undefined);
  // Expose the setter so tests can simulate external changes (form.reset)
  useEffect(() => {
    setExternalValue = setValue;
  }, []);
  return (
    <FieldInput
      field={{ name: "qty", label: "Qty", type, unitType }}
      value={value}
      onChange={(v) => {
        commits.push(v);
        setValue(v);
      }}
    />
  );
}

const { render: mount } = setupRenderHarness();

async function render(type: string) {
  const container = mount(<Harness type={type} />);
  return container.querySelector("input") as HTMLInputElement;
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

beforeEach(() => {
  commits.length = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FieldInput number case", () => {
  it("typing '-' shows '-' and commits undefined — never NaN", async () => {
    const input = await render("number");
    await act(async () => input.focus());

    await typeText(input, "-");

    expect(input.value).toBe("-"); // old behavior rendered "NaN"
    expect(commits.at(-1)).toBeUndefined();

    await typeText(input, "-5");
    expect(input.value).toBe("-5");
    expect(commits.at(-1)).toBe(-5);
  });

  it("typing '.5' shows '.5' and commits 0.5 once parseable", async () => {
    const input = await render("number");
    await act(async () => input.focus());

    await typeText(input, ".");
    expect(input.value).toBe(".");
    expect(commits.at(-1)).toBeUndefined();

    await typeText(input, ".5");
    expect(input.value).toBe(".5");
    expect(commits.at(-1)).toBe(0.5);
  });

  it("keeps in-progress decimals visible while focused", async () => {
    const input = await render("number");
    await act(async () => input.focus());

    await typeText(input, "1.");
    expect(input.value).toBe("1.");
    expect(commits.at(-1)).toBe(1);

    await typeText(input, "7.7530");
    expect(input.value).toBe("7.7530"); // not snapped to "7.753"
    expect(commits.at(-1)).toBe(7.753);
  });

  it("resyncs the display from the committed value on blur", async () => {
    const input = await render("number");
    await act(async () => input.focus());
    await typeText(input, "1.");

    await act(async () => input.blur());

    expect(input.value).toBe("1");
  });

  it("resyncs from external value changes while unfocused (form.reset)", async () => {
    const input = await render("number");

    await act(async () => setExternalValue(42));

    expect(input.value).toBe("42");
  });

  it("commits undefined when cleared", async () => {
    const input = await render("number");
    await act(async () => input.focus());
    await typeText(input, "5");
    await typeText(input, "");

    expect(input.value).toBe("");
    expect(commits.at(-1)).toBeUndefined();
  });
});

describe("FieldInput unit case without unitType (fallback number input)", () => {
  it("uses the same NaN-safe behavior as the number case", async () => {
    const input = await render("unit");
    await act(async () => input.focus());

    await typeText(input, "-");
    expect(input.value).toBe("-");
    expect(commits.at(-1)).toBeUndefined();

    await typeText(input, "-2.5");
    expect(commits.at(-1)).toBe(-2.5);
  });
});
