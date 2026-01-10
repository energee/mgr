"use client";

/**
 * New Batch Page
 */

import { EntityForm } from "@/components/universal/entity-form";
import { batchEntity } from "@/entities/batch";

export default function NewBatchPage() {
  return (
    <EntityForm
      entity={batchEntity}
      basePath="/production/batches"
    />
  );
}
