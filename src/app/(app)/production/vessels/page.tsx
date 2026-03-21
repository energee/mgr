"use client";

/**
 * Vessels List Page
 *
 * Displays all vessels using the universal EntityList component.
 */

import { EntityList } from "@/components/universal/entity-list";
import { vesselEntity } from "@/entities/vessel";

export default function VesselsPage() {
  return (
    <EntityList
      entity={vesselEntity}
      basePath="/production/vessels"
      defaultPageSize={50}
    />
  );
}
