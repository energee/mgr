"use client";

/**
 * Selling Formats Settings Page
 *
 * Manage selling formats (single, 4-pack, case, per keg) per container.
 * Uses the universal EntityList component with the sellingFormatEntity config.
 */

import { EntityList } from "@/components/universal/entity-list";
import { sellingFormatEntity } from "@/entities/selling-format";

export default function SellingFormatsPage() {
  return (
    <EntityList
      entity={sellingFormatEntity}
      basePath="/settings/selling-formats"
    />
  );
}
