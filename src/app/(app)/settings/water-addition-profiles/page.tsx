"use client";

/**
 * Water Addition Profiles Settings Page
 *
 * Manage reusable water salt/acid addition profiles.
 * Uses the universal EntityList component with waterAdditionProfileEntity config.
 */

import { EntityList } from "@/components/universal/entity-list";
import { waterAdditionProfileEntity } from "@/entities/water-addition-profile";

export default function WaterAdditionProfilesPage() {
  return (
    <EntityList
      entity={waterAdditionProfileEntity}
      basePath="/settings/water-addition-profiles"
    />
  );
}
