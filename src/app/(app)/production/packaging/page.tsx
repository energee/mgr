"use client";

/**
 * Packaging Sessions List Page
 *
 * Displays all packaging sessions using the universal EntityList component.
 */

import { EntityList } from "@/components/universal/entity-list";
import { packagingSessionEntity } from "@/entities/packaging-session";

export default function PackagingSessionsPage() {
  return (
    <EntityList
      entity={packagingSessionEntity}
      basePath="/production/packaging"
    />
  );
}
