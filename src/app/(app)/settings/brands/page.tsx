"use client";

/**
 * Brands Settings Page
 *
 * Manage beer brands and products.
 */

import { EntityList } from "@/components/universal/entity-list";
import { brandEntity } from "@/entities/brand";

export default function BrandsPage() {
  return (
    <EntityList
      entity={brandEntity}
      basePath="/settings/brands"
    />
  );
}
