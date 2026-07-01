// @vitest-environment jsdom
/**
 * Characterization tests for the pure presentational sub-components of
 * RecipeAdditionsDisplay: `AdditionsTable` and `OtherAdditionsSection`.
 *
 * The top-level `RecipeAdditionsDisplay` is a data-fetching container (Supabase
 * + react-query + useCatalog/useVolumeUnit), so its branch logic is covered
 * separately. The reusable *rendering* logic — additive name/Unknown fallback,
 * type/timing/target label maps with raw fallbacks, the conditional Target
 * column, timing grouping and count pluralization — lives in these two
 * hook-free sub-components and is pinned here so a B3 refactor can be checked
 * behavior-preserving. (WaterChemistrySummary + CalculatedAdditionsSection
 * remain uncovered — they need water-chemistry domain data / a useVolumeUnit
 * mock.)
 *
 * Follows the repo's render-test idiom (createRoot + act; no
 * @testing-library/react). No mocking needed: both components are pure.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// The module imports the Supabase client at top level, which runs env
// validation on import. These sub-components never touch the client, so stub
// it to keep the import (and the test) free of Supabase/env setup.
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

import {
  AdditionsTable,
  OtherAdditionsSection,
} from "../recipe-additions-display";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type Row = Parameters<typeof AdditionsTable>[0]["additions"][number];

/** Build a complete addition row; override only what a test cares about. */
const row = (o: Partial<Row>): Row => ({
  id: "1",
  additive_id: "x",
  amount: 1,
  unit: "g",
  timing: "boil",
  target: null,
  position: 0,
  additive: { id: "x", name: "X", type: "other", description: null },
  ...o,
});

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
});

describe("AdditionsTable", () => {
  it("renders name, mapped type label, amount+unit, and description; no Target column for non-water additions", () => {
    const c = render(
      <AdditionsTable
        additions={[
          row({
            id: "1",
            amount: 5,
            unit: "g",
            timing: "boil",
            additive: {
              id: "a1",
              name: "Whirlfloc",
              type: "clarifier",
              description: "fining agent",
            },
          }),
        ]}
      />,
    );
    expect(c.textContent).toContain("Whirlfloc");
    expect(c.textContent).toContain("Clarifier"); // TYPE_LABELS.clarifier
    expect(c.textContent).toContain("5 g");
    expect(c.textContent).toContain("fining agent");
    // hasTargets is false (clarifier is not water chemistry, showTarget unset)
    expect(c.querySelector("thead")?.textContent).not.toContain("Target");
  });

  it("falls back to 'Unknown' name and 'Other' type when additive is null", () => {
    const c = render(
      <AdditionsTable additions={[row({ id: "2", additive: null })]} />,
    );
    expect(c.textContent).toContain("Unknown");
    expect(c.textContent).toContain("Other"); // TYPE_LABELS.other
  });

  it("shows the Target column with mapped target label and an em-dash fallback when showTarget is set", () => {
    const c = render(
      <AdditionsTable
        showTarget
        additions={[
          row({
            id: "3",
            target: "mash",
            additive: { id: "g", name: "Gypsum", type: "water_salt", description: null },
          }),
          row({
            id: "4",
            target: null,
            additive: { id: "c", name: "CaCl2", type: "water_salt", description: null },
          }),
        ]}
      />,
    );
    expect(c.querySelector("thead")?.textContent).toContain("Target");
    expect(c.textContent).toContain("Water Salt"); // TYPE_LABELS.water_salt
    expect(c.textContent).toContain("Mash Water"); // TARGET_LABELS.mash
    expect(c.textContent).toContain("—"); // em-dash for the null target
  });

  it("auto-enables the Target column when a water-chemistry additive is present", () => {
    const c = render(
      <AdditionsTable
        additions={[
          row({
            id: "5",
            target: "sparge",
            additive: { id: "l", name: "Lactic Acid", type: "acid", description: null },
          }),
        ]}
      />,
    );
    expect(c.querySelector("thead")?.textContent).toContain("Target");
    expect(c.textContent).toContain("Sparge Water"); // TARGET_LABELS.sparge
  });
});

describe("OtherAdditionsSection", () => {
  it("groups rows by timing with mapped labels (raw fallback) and pluralized counts", () => {
    const c = render(
      <OtherAdditionsSection
        additions={[
          row({
            id: "1",
            timing: "boil",
            additive: { id: "w", name: "Whirlfloc", type: "clarifier", description: null },
          }),
          row({
            id: "2",
            timing: "boil",
            additive: { id: "n", name: "Yeast Nutrient", type: "nutrient", description: null },
          }),
          row({
            id: "3",
            timing: "mystery",
            additive: { id: "m", name: "Mystery Add", type: "other", description: null },
          }),
        ]}
      />,
    );
    expect(c.textContent).toContain("Boil"); // TIMING_LABELS.boil
    expect(c.textContent).toContain("(2 additions)"); // plural
    expect(c.textContent).toContain("mystery"); // raw fallback for unknown timing
    expect(c.textContent).toContain("(1 addition)"); // singular
    expect(c.textContent).toContain("Whirlfloc");
    expect(c.textContent).toContain("Yeast Nutrient");
    expect(c.textContent).toContain("Mystery Add");
  });
});
