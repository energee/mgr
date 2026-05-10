/**
 * Utilities for extracting key measurements from brew log events.
 *
 * Used by batch-brew-info (summary cards) and brew-log-completion-dialog
 * (review step) to display brew day highlights.
 */

import type { BrewEvent } from "@/types/domain";
import {
  formatTemperature,
  formatGravity,
  formatVolume,
  type GravityUnit,
  type TemperatureUnit,
  type VolumeUnit,
} from "@/lib/units";

export type BrewMeasurementHighlight = {
  label: string;
  value: string;
}

export type BrewMeasurementUnits = {
  temperature: TemperatureUnit;
  gravity: GravityUnit;
  volume: VolumeUnit;
};

const DEFAULT_UNITS: BrewMeasurementUnits = {
  temperature: "f",
  gravity: "plato",
  volume: "bbl",
};

function findMeasurement(
  events: BrewEvent[],
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
  events: BrewEvent[],
  units: BrewMeasurementUnits = DEFAULT_UNITS,
): BrewMeasurementHighlight[] {
  const highlights: BrewMeasurementHighlight[] = [];

  const mashTemp = findMeasurement(events, ["mash_in", "mash_rest"], "temp_f");
  if (mashTemp) {
    highlights.push({ label: "Mash Temp", value: formatTemperature(Number(mashTemp.value), units.temperature, 0) });
  }

  const preBoilGravity = findMeasurement(
    events,
    ["kettle_full", "boil_start"],
    "gravity_plato",
  );
  if (preBoilGravity) {
    highlights.push({ label: "Pre-Boil Gravity", value: formatGravity(Number(preBoilGravity.value), units.gravity) });
  }

  const postBoilOG = findMeasurement(
    events,
    ["boil_end", "ko_start"],
    "gravity_plato",
  );
  if (postBoilOG) {
    highlights.push({ label: "Post-Boil OG", value: formatGravity(Number(postBoilOG.value), units.gravity) });
  }

  const postBoilVol = findMeasurement(
    events,
    ["boil_end", "ko_start", "ko_end"],
    "volume_bbl",
  );
  if (postBoilVol) {
    highlights.push({ label: "Post-Boil Vol", value: formatVolume(Number(postBoilVol.value), units.volume) });
  }

  const koTemp = findMeasurement(events, ["ko_end"], "temp_f");
  if (koTemp) {
    highlights.push({ label: "Knockout Temp", value: formatTemperature(Number(koTemp.value), units.temperature, 0) });
  }

  return highlights;
}
