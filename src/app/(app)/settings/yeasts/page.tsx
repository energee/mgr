"use client";

/**
 * Yeast Strains Settings Page
 *
 * Manage yeast strain catalog for recipe building.
 * Uses the universal EntityList component with yeastStrainEntity config.
 */

import { EntityList } from "@/components/universal/entity-list";
import { yeastStrainEntity } from "@/entities/yeast-strain";

export default function YeastStrainsPage() {
  return (
    <EntityList
      entity={yeastStrainEntity}
      basePath="/settings/yeasts"
    />
  );
}
