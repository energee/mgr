"use client";

/**
 * Edit Batch Page
 */

import { use } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { batchEntity } from "@/entities/batch";

export default function EditBatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <EntityForm
      entity={batchEntity}
      id={id}
      basePath="/production/batches"
    />
  );
}
