"use client";

/**
 * Batch Detail Page
 */

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { batchEntity } from "@/entities/batch";

export default function BatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <EntityDetail
      entity={batchEntity}
      id={id}
      basePath="/production/batches"
    />
  );
}
