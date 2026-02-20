"use client";

/**
 * Water Profiles Settings Page
 *
 * Lists all water profiles (source and target water chemistry).
 * Salt additions are calculated on-the-fly from source/target deltas on recipes.
 */

import { EntityList } from "@/components/universal/entity-list";
import { waterProfileEntity } from "@/entities/water-profile";

export default function WaterProfilesPage() {
  return (
    <EntityList
      entity={waterProfileEntity}
      basePath="/settings/water-profiles"
    />
  );
}
