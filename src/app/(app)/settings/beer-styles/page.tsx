"use client";

/**
 * Beer Styles Settings Page
 *
 * Manage BJCP styles and custom brewery styles.
 */

import { EntityList } from "@/components/universal/entity-list";
import { beerStyleEntity } from "@/entities/beer-style";

export default function BeerStylesPage() {
  return (
    <EntityList
      entity={beerStyleEntity}
      basePath="/settings/beer-styles"
    />
  );
}
