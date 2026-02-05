"use client";

/**
 * Package Formats Settings Page
 *
 * Manage package types (cans, bottles, kegs, etc.) used in packaging sessions.
 * Uses the universal EntityList component with the packageTypeEntity config.
 */

import { EntityList } from "@/components/universal/entity-list";
import { packageTypeEntity } from "@/entities/package-type";

export default function PackageFormatsPage() {
  return (
    <EntityList
      entity={packageTypeEntity}
      basePath="/settings/formats"
    />
  );
}
