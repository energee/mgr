"use client";

/**
 * Yeast Pitches List Page
 *
 * Track individual yeast pitches from purchase through repitching.
 * Uses the universal EntityList component with yeastPitchEntity config.
 */

import { EntityList } from "@/components/universal/entity-list";
import { yeastPitchEntity } from "@/entities/yeast-pitch";

export default function YeastPitchesPage() {
  return (
    <EntityList
      entity={yeastPitchEntity}
      basePath="/production/yeast-pitches"
    />
  );
}
