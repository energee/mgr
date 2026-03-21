"use client";

/**
 * Brand Detail Page
 *
 * Standard entity detail with an additional packaging production summary section.
 */

import { use } from "react";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { brandEntity } from "@/entities/brand";
import { BrandPackagingSummary } from "@/components/domain/brand-packaging-summary";

export default function BrandDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <div className="space-y-6">
      <EntityDetailUnifiedWithErrorBoundary entity={brandEntity} id={id} basePath="/settings/brands" />
      <BrandPackagingSummary brandId={id} />
    </div>
  );
}
