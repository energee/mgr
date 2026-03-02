/**
 * Tests for brew event measurement extraction utilities.
 *
 * Covers extractBrewMeasurements — the function that pulls key brew day
 * measurements from an array of typed brew events and returns formatted
 * label/value highlight pairs.
 */
import { describe, it, expect } from "vitest";
import {
  extractBrewMeasurements,
  type BrewMeasurementHighlight,
} from "@/lib/brew-events";

// =============================================================================
// Helpers
// =============================================================================

/** Shorthand for building a brew event with a single measurement. */
function makeEvent(
  phase: string,
  metric: string,
  value: number | string,
): { phase: string; measurements: { metric: string; value: number | string }[] } {
  return { phase, measurements: [{ metric, value }] };
}

/** Shorthand for building a brew event with multiple measurements. */
function makeEventMulti(
  phase: string,
  measurements: { metric: string; value: number | string }[],
): { phase: string; measurements: { metric: string; value: number | string }[] } {
  return { phase, measurements };
}

// =============================================================================
// Empty / No Data
// =============================================================================

describe("extractBrewMeasurements — empty inputs", () => {
  it("returns empty array for empty events array", () => {
    expect(extractBrewMeasurements([])).toEqual([]);
  });

  it("returns empty array when events have no measurements", () => {
    const events = [{ phase: "mash_in" }, { phase: "boil_end" }];
    expect(extractBrewMeasurements(events)).toEqual([]);
  });

  it("returns empty array when events have empty measurements arrays", () => {
    const events = [
      { phase: "mash_in", measurements: [] },
      { phase: "boil_end", measurements: [] },
    ];
    expect(extractBrewMeasurements(events)).toEqual([]);
  });

  it("returns empty array when events have unrecognised phases", () => {
    const events = [makeEvent("fermentation", "temp_f", 68)];
    expect(extractBrewMeasurements(events)).toEqual([]);
  });

  it("returns empty array when events have unrecognised metrics", () => {
    const events = [makeEvent("mash_in", "ph", 5.4)];
    expect(extractBrewMeasurements(events)).toEqual([]);
  });
});

// =============================================================================
// Individual Measurement Extraction
// =============================================================================

describe("extractBrewMeasurements — mash temp", () => {
  it("extracts mash temp from mash_in phase", () => {
    const result = extractBrewMeasurements([makeEvent("mash_in", "temp_f", 152)]);
    expect(result).toEqual([{ label: "Mash Temp", value: "152\u00B0F" }]);
  });

  it("extracts mash temp from mash_rest phase", () => {
    const result = extractBrewMeasurements([makeEvent("mash_rest", "temp_f", 154)]);
    expect(result).toEqual([{ label: "Mash Temp", value: "154\u00B0F" }]);
  });

  it("uses first matching phase (mash_in over mash_rest)", () => {
    const events = [
      makeEvent("mash_in", "temp_f", 152),
      makeEvent("mash_rest", "temp_f", 154),
    ];
    const result = extractBrewMeasurements(events);
    const mashTemp = result.find((h) => h.label === "Mash Temp");
    expect(mashTemp).toEqual({ label: "Mash Temp", value: "152\u00B0F" });
  });
});

describe("extractBrewMeasurements — pre-boil gravity", () => {
  it("extracts pre-boil gravity from kettle_full phase", () => {
    const result = extractBrewMeasurements([
      makeEvent("kettle_full", "gravity_plato", 11.5),
    ]);
    expect(result).toEqual([{ label: "Pre-Boil Gravity", value: "11.5\u00B0P" }]);
  });

  it("extracts pre-boil gravity from boil_start phase", () => {
    const result = extractBrewMeasurements([
      makeEvent("boil_start", "gravity_plato", 12),
    ]);
    expect(result).toEqual([{ label: "Pre-Boil Gravity", value: "12\u00B0P" }]);
  });
});

describe("extractBrewMeasurements — post-boil OG", () => {
  it("extracts post-boil OG from boil_end phase", () => {
    const result = extractBrewMeasurements([
      makeEvent("boil_end", "gravity_plato", 13.2),
    ]);
    expect(result).toEqual([
      { label: "Post-Boil OG", value: "13.2\u00B0P" },
    ]);
  });

  it("extracts post-boil OG from ko_start phase", () => {
    const result = extractBrewMeasurements([
      makeEvent("ko_start", "gravity_plato", 13.5),
    ]);
    expect(result).toEqual([
      { label: "Post-Boil OG", value: "13.5\u00B0P" },
    ]);
  });
});

describe("extractBrewMeasurements — post-boil volume", () => {
  it("extracts post-boil volume from boil_end phase", () => {
    const result = extractBrewMeasurements([
      makeEvent("boil_end", "volume_bbl", 7.5),
    ]);
    // boil_end also matches post-boil OG (gravity_plato), but we only have volume_bbl here
    expect(result).toEqual([{ label: "Post-Boil Vol", value: "7.5 BBL" }]);
  });

  it("extracts post-boil volume from ko_start phase", () => {
    const result = extractBrewMeasurements([
      makeEvent("ko_start", "volume_bbl", 7),
    ]);
    expect(result).toEqual([{ label: "Post-Boil Vol", value: "7 BBL" }]);
  });

  it("extracts post-boil volume from ko_end phase", () => {
    const result = extractBrewMeasurements([
      makeEvent("ko_end", "volume_bbl", 6.8),
    ]);
    // ko_end also matches knockout temp (temp_f), but we only have volume_bbl here
    expect(result).toEqual([{ label: "Post-Boil Vol", value: "6.8 BBL" }]);
  });
});

describe("extractBrewMeasurements — knockout temp", () => {
  it("extracts knockout temp from ko_end phase", () => {
    const result = extractBrewMeasurements([makeEvent("ko_end", "temp_f", 65)]);
    expect(result).toEqual([{ label: "Knockout Temp", value: "65\u00B0F" }]);
  });

  it("does not extract knockout temp from other phases", () => {
    // temp_f in mash_in should only produce Mash Temp, not Knockout Temp
    const result = extractBrewMeasurements([makeEvent("mash_in", "temp_f", 152)]);
    const koTemp = result.find((h) => h.label === "Knockout Temp");
    expect(koTemp).toBeUndefined();
  });
});

// =============================================================================
// Multiple Events — Full Brew Day
// =============================================================================

describe("extractBrewMeasurements — full brew day", () => {
  it("extracts all five measurements from a complete brew day", () => {
    // Note: findMeasurement uses events.find() to locate the first event
    // matching the phase, then looks for the metric within that event.
    // So gravity and volume from the same phase must be on the same event.
    const events = [
      makeEvent("mash_in", "temp_f", 152),
      makeEvent("kettle_full", "gravity_plato", 11.5),
      makeEventMulti("boil_end", [
        { metric: "gravity_plato", value: 13.2 },
        { metric: "volume_bbl", value: 7.5 },
      ]),
      makeEvent("ko_end", "temp_f", 65),
    ];
    const result = extractBrewMeasurements(events);

    expect(result).toHaveLength(5);
    expect(result[0]).toEqual({ label: "Mash Temp", value: "152\u00B0F" });
    expect(result[1]).toEqual({ label: "Pre-Boil Gravity", value: "11.5\u00B0P" });
    expect(result[2]).toEqual({ label: "Post-Boil OG", value: "13.2\u00B0P" });
    expect(result[3]).toEqual({ label: "Post-Boil Vol", value: "7.5 BBL" });
    expect(result[4]).toEqual({ label: "Knockout Temp", value: "65\u00B0F" });
  });

  it("maintains consistent ordering regardless of event order in the array", () => {
    // Volume and gravity on ko_end together, since findMeasurement picks
    // the first event matching the phase.
    const events = [
      makeEventMulti("ko_end", [
        { metric: "temp_f", value: 65 },
        { metric: "volume_bbl", value: 6.8 },
      ]),
      makeEvent("boil_end", "gravity_plato", 13.2),
      makeEvent("mash_in", "temp_f", 152),
      makeEvent("kettle_full", "gravity_plato", 11.5),
    ];
    const result = extractBrewMeasurements(events);

    // Order should always be: Mash Temp, Pre-Boil Gravity, Post-Boil OG, Post-Boil Vol, Knockout Temp
    expect(result.map((h) => h.label)).toEqual([
      "Mash Temp",
      "Pre-Boil Gravity",
      "Post-Boil OG",
      "Post-Boil Vol",
      "Knockout Temp",
    ]);
  });
});

// =============================================================================
// Partial Data
// =============================================================================

describe("extractBrewMeasurements — partial data", () => {
  it("extracts only available measurements (mash temp + knockout temp)", () => {
    const events = [
      makeEvent("mash_in", "temp_f", 152),
      makeEvent("ko_end", "temp_f", 66),
    ];
    const result = extractBrewMeasurements(events);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ label: "Mash Temp", value: "152\u00B0F" });
    expect(result[1]).toEqual({ label: "Knockout Temp", value: "66\u00B0F" });
  });

  it("extracts single available measurement", () => {
    const events = [makeEvent("kettle_full", "gravity_plato", 11.2)];
    const result = extractBrewMeasurements(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ label: "Pre-Boil Gravity", value: "11.2\u00B0P" });
  });

  it("skips events where measurement metric does not match", () => {
    const events = [
      makeEvent("mash_in", "volume_bbl", 10), // wrong metric for mash phase
      makeEvent("ko_end", "gravity_plato", 13), // wrong metric for ko_end
    ];
    const result = extractBrewMeasurements(events);
    expect(result).toEqual([]);
  });
});

// =============================================================================
// Multiple Measurements per Event
// =============================================================================

describe("extractBrewMeasurements — events with multiple measurements", () => {
  it("extracts both gravity and volume from boil_end event with multiple measurements", () => {
    const events = [
      makeEventMulti("boil_end", [
        { metric: "gravity_plato", value: 13.2 },
        { metric: "volume_bbl", value: 7.5 },
      ]),
    ];
    const result = extractBrewMeasurements(events);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ label: "Post-Boil OG", value: "13.2\u00B0P" });
    expect(result[1]).toEqual({ label: "Post-Boil Vol", value: "7.5 BBL" });
  });

  it("extracts both volume and temp from ko_end event with multiple measurements", () => {
    const events = [
      makeEventMulti("ko_end", [
        { metric: "volume_bbl", value: 6.8 },
        { metric: "temp_f", value: 64 },
      ]),
    ];
    const result = extractBrewMeasurements(events);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ label: "Post-Boil Vol", value: "6.8 BBL" });
    expect(result[1]).toEqual({ label: "Knockout Temp", value: "64\u00B0F" });
  });
});

// =============================================================================
// Edge Cases — Value Types
// =============================================================================

describe("extractBrewMeasurements — edge cases with values", () => {
  it("handles zero values", () => {
    const result = extractBrewMeasurements([makeEvent("mash_in", "temp_f", 0)]);
    expect(result).toEqual([{ label: "Mash Temp", value: "0\u00B0F" }]);
  });

  it("handles string values (the TypedBrewEvent allows string values)", () => {
    const result = extractBrewMeasurements([makeEvent("mash_in", "temp_f", "152")]);
    expect(result).toEqual([{ label: "Mash Temp", value: "152\u00B0F" }]);
  });

  it("handles decimal precision in values", () => {
    const result = extractBrewMeasurements([
      makeEvent("kettle_full", "gravity_plato", 11.567),
    ]);
    expect(result).toEqual([
      { label: "Pre-Boil Gravity", value: "11.567\u00B0P" },
    ]);
  });

  it("excludes measurements where value is undefined", () => {
    const events = [
      { phase: "mash_in", measurements: [{ metric: "temp_f", value: undefined }] },
    ];
    const result = extractBrewMeasurements(events);
    expect(result).toEqual([]);
  });

  it("excludes measurements where metric is missing", () => {
    const events = [
      { phase: "mash_in", measurements: [{ value: 152 }] },
    ];
    const result = extractBrewMeasurements(events);
    expect(result).toEqual([]);
  });
});

// =============================================================================
// Edge Cases — Event Structure
// =============================================================================

describe("extractBrewMeasurements — edge cases with event structure", () => {
  it("handles events with no phase property", () => {
    const events = [{ measurements: [{ metric: "temp_f", value: 152 }] }];
    const result = extractBrewMeasurements(events);
    expect(result).toEqual([]);
  });

  it("handles events with undefined phase", () => {
    const events = [
      { phase: undefined, measurements: [{ metric: "temp_f", value: 152 }] },
    ];
    const result = extractBrewMeasurements(events);
    expect(result).toEqual([]);
  });

  it("handles completely empty event objects", () => {
    const events = [{}];
    const result = extractBrewMeasurements(events);
    expect(result).toEqual([]);
  });

  it("throws on null entries in events array (no null guard)", () => {
    // The function casts unknown[] to TypedBrewEvent[] and accesses .phase
    // directly via find(), so null entries cause a TypeError.
    const events = [null, makeEvent("mash_in", "temp_f", 152)];
    expect(() => extractBrewMeasurements(events as unknown[])).toThrow(TypeError);
  });
});

// =============================================================================
// findMeasurement Behavior — Phase Deduplication
// =============================================================================

describe("extractBrewMeasurements — findMeasurement picks first matching phase event", () => {
  it("does not find a metric on a second event with the same phase", () => {
    // Two separate boil_end events: first has gravity, second has volume.
    // findMeasurement finds the first boil_end event for volume_bbl lookup,
    // but that event only has gravity_plato, so volume is not found.
    const events = [
      makeEvent("boil_end", "gravity_plato", 13.2),
      makeEvent("boil_end", "volume_bbl", 7.5),
    ];
    const result = extractBrewMeasurements(events);
    // Only post-boil OG is found; post-boil volume is missed
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ label: "Post-Boil OG", value: "13.2\u00B0P" });
  });

  it("finds both metrics when they are on the same event", () => {
    const events = [
      makeEventMulti("boil_end", [
        { metric: "gravity_plato", value: 13.2 },
        { metric: "volume_bbl", value: 7.5 },
      ]),
    ];
    const result = extractBrewMeasurements(events);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ label: "Post-Boil OG", value: "13.2\u00B0P" });
    expect(result[1]).toEqual({ label: "Post-Boil Vol", value: "7.5 BBL" });
  });
});

// =============================================================================
// Output Format Verification
// =============================================================================

describe("extractBrewMeasurements — output format", () => {
  it("returns BrewMeasurementHighlight objects with label and value strings", () => {
    const events = [makeEvent("mash_in", "temp_f", 155)];
    const result = extractBrewMeasurements(events);

    expect(result).toHaveLength(1);
    const highlight: BrewMeasurementHighlight = result[0];
    expect(typeof highlight.label).toBe("string");
    expect(typeof highlight.value).toBe("string");
  });

  it("formats temperature values with degree-F suffix", () => {
    const events = [
      makeEvent("mash_in", "temp_f", 152),
      makeEvent("ko_end", "temp_f", 65),
    ];
    const result = extractBrewMeasurements(events);
    expect(result[0].value).toBe("152\u00B0F");
    expect(result[1].value).toBe("65\u00B0F");
  });

  it("formats gravity values with degree-P suffix", () => {
    const events = [
      makeEvent("kettle_full", "gravity_plato", 11.5),
      makeEvent("boil_end", "gravity_plato", 13.2),
    ];
    const result = extractBrewMeasurements(events);
    expect(result[0].value).toBe("11.5\u00B0P");
    expect(result[1].value).toBe("13.2\u00B0P");
  });

  it("formats volume values with BBL suffix", () => {
    const events = [makeEvent("boil_end", "volume_bbl", 7.5)];
    const result = extractBrewMeasurements(events);
    expect(result[0].value).toBe("7.5 BBL");
  });
});
