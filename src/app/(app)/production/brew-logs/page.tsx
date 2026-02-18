"use client";

/**
 * Brew Logs List Page
 *
 * Displays all brew logs using the universal EntityList component.
 * Brew days are started from the Batches page, not from here.
 */

import { EntityList } from "@/components/universal/entity-list";
import { brewLogEntity } from "@/entities/brew-log";

export default function BrewLogsPage() {
  return (
    <EntityList
      entity={brewLogEntity}
      basePath="/production/brew-logs"
    />
  );
}
