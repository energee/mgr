/**
 * UnitInput keyboard-behavior tests (U1 audit finding):
 * - raw typed strings survive controlled re-renders (no mid-keystroke
 *   rounding from formatSmartDecimal)
 * - "-" / "." in-progress strings commit null, never NaN
 * - display resyncs from the canonical value on blur, on external value
 *   changes while unfocused, and on display-unit changes even while focused
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, useEffect, useState } from "react";
import { setupRenderHarness } from "@/test/react-harness";
import type { UnitType } from "@/domain/units";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// Controllable unit-preferences mock (avoids supabase/react-query)
let mockPrefs: Record<string, string>;
vi.mock("@/hooks/use-unit-preferences", () => ({
  useUnitPreferences: () => ({ data: mockPrefs, isLoading: false }),
}));

import { UnitInput } from "@/components/ui/unit-input";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const commits: (number | null)[] = [];
let setExternalValue: (v: number | null) => void;

function Harness({ unitType }: { unitType: UnitType }) {
  const [value, setValue] = useState<number | null>(null);
  // Expose the setter so tests can simulate external changes (form.reset)
  useEffect(() => {
    setExternalValue = setValue;
  }, []);
  return (
    <UnitInput
      value={value}
      unitType={unitType}
      onChange={(v) => {
        commits.push(v);
        setValue(v);
      }}
    />
  );
}

const { render: mount, rerender: rerenderHarness } = setupRenderHarness();

async function render(unitType: UnitType) {
  const container = mount(<Harness unitType={unitType} />);
  return container.querySelector("input") as HTMLInputElement;
}

async function rerender(unitType: UnitType) {
  rerenderHarness(<Harness unitType={unitType} />);
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
  mockPrefs = {
    volume_unit: "bbl",
    weight_unit: "lbs",
    temperature_unit: "f",
    gravity_unit: "plato",
    retail_volume_unit: "oz",
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("UnitInput raw-string editing", () => {
  it("keeps extra decimals visible while typing and commits the precise value", async () => {
    const input = await render("volume");
    await act(async () => input.focus());

    await typeText(input, "7.75");
    await typeText(input, "7.753");

    // Old behavior snapped the visible text to formatSmartDecimal(…, 2) = "7.75"
    expect(input.value).toBe("7.753");
    expect(commits.at(-1)).toBe(7.753); // bbl is canonical for volume
  });

  it("allows in-progress '-' (commits null, never NaN, text preserved)", async () => {
    const input = await render("temperature");
    await act(async () => input.focus());

    await typeText(input, "-");
    expect(input.value).toBe("-");
    expect(commits.at(-1)).toBeNull();

    await typeText(input, "-5");
    expect(input.value).toBe("-5");
    expect(commits.at(-1)).toBe(-5); // °F is canonical for temperature
  });

  it("formats the display from the committed value on blur", async () => {
    const input = await render("volume");
    await act(async () => input.focus());
    await typeText(input, "7.753");

    await act(async () => input.blur());

    expect(input.value).toBe("7.75"); // formatSmartDecimal at rest
    expect(commits.at(-1)).toBe(7.753); // stored value keeps full precision
  });

  it("resyncs the text when the display unit changes, even while focused", async () => {
    const input = await render("volume");
    await act(async () => input.focus());
    await typeText(input, "2"); // 2 bbl canonical

    mockPrefs = { ...mockPrefs, volume_unit: "gal" };
    await rerender("volume");

    expect(input.value).toBe("62"); // 2 bbl = 62 gal
    expect(commits.at(-1)).toBe(2); // canonical value untouched
  });

  it("converts typed display values to canonical units", async () => {
    mockPrefs = { ...mockPrefs, volume_unit: "gal" };
    const input = await render("volume");
    await act(async () => input.focus());

    await typeText(input, "31");

    expect(commits.at(-1)).toBe(1); // 31 gal = 1 bbl
    expect(input.value).toBe("31"); // text untouched while focused
  });

  it("resyncs from external value changes while unfocused", async () => {
    const input = await render("volume");

    await act(async () => setExternalValue(3));

    expect(input.value).toBe("3");
  });

  it("does not clobber typing from external-looking re-renders while focused", async () => {
    const input = await render("volume");
    await act(async () => input.focus());

    await typeText(input, "1.");
    await rerender("volume"); // parent re-render mid-edit

    expect(input.value).toBe("1.");
    expect(commits.at(-1)).toBe(1);
  });
});
