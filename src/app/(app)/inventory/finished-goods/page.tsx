"use client";

/**
 * Finished Goods List Page
 *
 * Displays all finished goods (packaged products) using the universal EntityList component.
 * Shows inventory levels including total, allocated, and available quantities.
 */

import { EntityList } from "@/components/universal/entity-list";
import { finishedGoodEntity } from "@/entities/finished-good";

export default function FinishedGoodsPage() {
  return (
    <EntityList
      entity={finishedGoodEntity}
      basePath="/inventory/finished-goods"
    />
  );
}
