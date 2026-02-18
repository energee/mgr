"use client";

/**
 * Water Profiles Settings Page
 *
 * Manage source water chemistry profiles (mineral content).
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
