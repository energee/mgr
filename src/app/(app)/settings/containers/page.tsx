"use client";

/**
 * Containers Settings Page
 *
 * Manage physical containers (cans, bottles, kegs) and their selling formats.
 * Uses the universal EntityList component with the containerEntity config.
 */

import { EntityList } from "@/components/universal/entity-list";
import { containerEntity } from "@/entities/container";

export default function ContainersPage() {
  return (
    <EntityList
      entity={containerEntity}
      basePath="/settings/containers"
    />
  );
}
