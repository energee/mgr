"use client";

/**
 * Finished Good Detail Page
 *
 * Shows details of a packaged product including inventory status and allocation history.
 */

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { finishedGoodEntity } from "@/entities/finished-good";

export default function FinishedGoodDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <EntityDetail
      entity={finishedGoodEntity}
      id={id}
      basePath="/inventory/finished-goods"
    />
  );
}
