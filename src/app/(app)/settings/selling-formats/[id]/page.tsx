"use client";

/**
 * Selling Format Detail Page
 *
 * View/edit a selling format.
 */

import { use } from "react";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { sellingFormatEntity } from "@/entities/selling-format";

export default function SellingFormatDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={sellingFormatEntity}
      id={id}
      basePath="/settings/selling-formats"
    />
  );
}
