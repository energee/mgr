// @vitest-environment jsdom
/**
 * Characterization tests for the pure presentational sub-components of
 * RecipeAdditionsDisplay: `AdditionsTable` and `OtherAdditionsSection`.
 *
 * The top-level `RecipeAdditionsDisplay` is a data-fetching container (Supabase
 * + react-query + useCatalog/useResolvedUnitPreferences), so its branch logic is covered
 * separately. The reusable *rendering* logic — additive name/Unknown fallback,
 * type/timing/target label maps with raw fallbacks, the conditional Target
 * column, timing grouping and count pluralization — lives in these two
 * hook-free sub-components and is pinned here so a B3 refactor can be checked
 * behavior-preserving. (WaterChemistrySummary + CalculatedAdditionsSection
 * remain uncovered — they need water-chemistry domain data / a unit-preferences
 * mock.)
 *
 * Follows the repo's render-test idiom (createRoot + act; no
 * @testing-library/react). No mocking needed: both components are pure.
 */

import { describe, it, expect, vi } from "vitest";
import { setupRenderHarness } from "@/test/react-harness";

// The module imports the Supabase client at top level, which runs env
// validation on import. These sub-components never touch the client, so stub
// it to keep the import (and the test) free of Supabase/env setup.
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
// CalculatedAdditionsSection reads the display volume unit via this hook.
vi.mock("@/hooks/use-unit-preferences", () => ({ useResolvedUnitPreferences: () => ({ volume_unit: "bbl" }) }));

import {
  AdditionsTable,
  OtherAdditionsSection,
  WaterChemistrySummary,
  CalculatedAdditionsSection,
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

const { render } = setupRenderHarness();

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

type WProfile = Parameters<typeof WaterChemistrySummary>[0]["target"];
const wp = (o: Partial<WProfile>): WProfile => ({
  calcium_ppm: 0,
  magnesium_ppm: 0,
  sodium_ppm: 0,
  sulfate_ppm: 0,
  chloride_ppm: 0,
  bicarbonate_ppm: 0,
  ...o,
});

describe("WaterChemistrySummary", () => {
  it("renders source/target/result rows with rounded ppm, plus the SO4:Cl ratio and its description", () => {
    const c = render(
      <WaterChemistrySummary
        source={{ ...wp({ calcium_ppm: 50.4 }), name: "Tap Water" }}
        target={wp({ sulfate_ppm: 150, chloride_ppm: 75 })}
        targetName="Hoppy Pale"
        resulting={wp({ sulfate_ppm: 150, chloride_ppm: 75 })}
      />,
    );
    expect(c.textContent).toContain("Ca²⁺"); // WATER_IONS calcium label
    expect(c.textContent).toContain("Source");
    expect(c.textContent).toContain("Target");
    expect(c.textContent).toContain("Result");
    expect(c.textContent).toContain("Tap Water"); // source name
    expect(c.textContent).toContain("Hoppy Pale"); // target name
    expect(c.textContent).toContain("50"); // Math.round(50.4)
    // round1(150 / 75) = 2 → "2:1"; getRatioDescription(2) → "Hoppy"
    expect(c.textContent).toContain("2:1");
    expect(c.textContent).toContain("Hoppy");
  });
});

type Salts = Parameters<typeof CalculatedAdditionsSection>[0]["additions"];
const salts = (o: Partial<Salts>): Salts => ({
  gypsum_g: 0,
  calcium_chloride_g: 0,
  epsom_salt_g: 0,
  baking_soda_g: 0,
  chalk_g: 0,
  table_salt_g: 0,
  magnesium_chloride_g: 0,
  ...o,
});

describe("CalculatedAdditionsSection", () => {
  const noop = () => {};

  it("lists only non-zero salts with mapped names and 1-decimal grams, plus an Apply button", () => {
    const c = render(
      <CalculatedAdditionsSection
        additions={salts({ gypsum_g: 5.25, epsom_salt_g: 2 })}
        onApply={noop}
        isApplying={false}
        applySuccess={false}
        totalVolumeGal={310}
      />,
    );
    expect(c.textContent).toContain("Gypsum"); // SALT_ADDITIVE_MAP.gypsum_g
    expect(c.textContent).toContain("5.3 g"); // (5.25).toFixed(1)
    expect(c.textContent).toContain("Epsom Salt");
    expect(c.textContent).toContain("2.0 g");
    expect(c.textContent).not.toContain("Calcium Chloride"); // zero → omitted
    expect(c.textContent).toContain("Apply to Recipe");
  });

  it("shows 'Applied' instead of the apply label when applySuccess is set", () => {
    const c = render(
      <CalculatedAdditionsSection
        additions={salts({ gypsum_g: 1 })}
        onApply={noop}
        isApplying={false}
        applySuccess
        totalVolumeGal={310}
      />,
    );
    expect(c.textContent).toContain("Applied");
    expect(c.textContent).not.toContain("Apply to Recipe");
  });

  it("renders nothing when every salt is zero", () => {
    const c = render(
      <CalculatedAdditionsSection
        additions={salts({})}
        onApply={noop}
        isApplying={false}
        applySuccess={false}
        totalVolumeGal={310}
      />,
    );
    expect(c.textContent).not.toContain("Calculated Salt Additions");
  });
});
