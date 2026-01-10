"use client";

/**
 * Batches List Page
 *
 * Displays all batches using the universal EntityList component.
 * This demonstrates how pages become trivial with the entity system.
 */

import { EntityList } from "@/components/universal/entity-list";
import { batchEntity } from "@/entities/batch";

export default function BatchesPage() {
  return (
    <EntityList
      entity={batchEntity}
      basePath="/production/batches"
    />
  );
}
