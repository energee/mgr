/**
 * Utilities for extracting key measurements from brew log events.
 *
 * Used by batch-brew-info (summary cards) and brew-log-completion-dialog
 * (review step) to display brew day highlights.
 */

interface TypedBrewEvent {
  phase?: string;
  measurements?: Array<{ metric?: string; value?: number | string }>;
}

export interface BrewMeasurementHighlight {
  label: string;
  value: string;
}

function findMeasurement(
  events: TypedBrewEvent[],
  phases: string[],
  metric: string,
): { value: number | string } | undefined {
  const event = events.find((e) => phases.includes(e.phase ?? ""));
  const m = event?.measurements?.find((m) => m.metric === metric);
  return m?.value !== undefined ? { value: m.value } : undefined;
}

/**
 * Extracts key brew day measurements from an events array.
 *
 * Returns a formatted list of label/value pairs for display. The measurements
 * extracted (in order): mash temp, pre-boil gravity, post-boil OG, post-boil
 * volume, and knockout temp.
 */
export function extractBrewMeasurements(
  events: unknown[],
): BrewMeasurementHighlight[] {
  const typedEvents = events as TypedBrewEvent[];
  const highlights: BrewMeasurementHighlight[] = [];

  const mashTemp = findMeasurement(typedEvents, ["mash_in", "mash_rest"], "temp_f");
  if (mashTemp) {
    highlights.push({ label: "Mash Temp", value: `${mashTemp.value}\u00B0F` });
  }

  const preBoilGravity = findMeasurement(
    typedEvents,
    ["kettle_full", "boil_start"],
    "gravity_plato",
  );
  if (preBoilGravity) {
    highlights.push({ label: "Pre-Boil Gravity", value: `${preBoilGravity.value}\u00B0P` });
  }

  const postBoilOG = findMeasurement(
    typedEvents,
    ["boil_end", "ko_start"],
    "gravity_plato",
  );
  if (postBoilOG) {
    highlights.push({ label: "Post-Boil OG", value: `${postBoilOG.value}\u00B0P` });
  }

  const postBoilVol = findMeasurement(
    typedEvents,
    ["boil_end", "ko_start", "ko_end"],
    "volume_bbl",
  );
  if (postBoilVol) {
    highlights.push({ label: "Post-Boil Vol", value: `${postBoilVol.value} BBL` });
  }

  const koTemp = findMeasurement(typedEvents, ["ko_end"], "temp_f");
  if (koTemp) {
    highlights.push({ label: "Knockout Temp", value: `${koTemp.value}\u00B0F` });
  }

  return highlights;
}
