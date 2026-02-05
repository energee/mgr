"use client";

/**
 * Keg Types Settings Page
 *
 * Manage keg sizes used for packaging and inventory tracking.
 * Uses the universal EntityList component with the kegTypeEntity config.
 */

import { EntityList } from "@/components/universal/entity-list";
import { kegTypeEntity } from "@/entities/keg-type";

export default function KegTypesPage() {
  return (
    <EntityList
      entity={kegTypeEntity}
      basePath="/settings/keg-types"
    />
  );
}
