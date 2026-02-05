"use client";

/**
 * Locations Settings Page
 *
 * Manage physical locations (breweries, warehouses, taprooms, storage).
 * Uses the universal EntityList component with the locationEntity config.
 */

import { EntityList } from "@/components/universal/entity-list";
import { locationEntity } from "@/entities/location";

export default function LocationsPage() {
  return (
    <EntityList
      entity={locationEntity}
      basePath="/settings/locations"
    />
  );
}
