"use client";

import { use } from "react";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { kegOwnerEntity } from "@/entities/keg-owner";

export default function KegOwnerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={kegOwnerEntity}
      id={id}
      basePath="/inventory/kegs/owners"
    />
  );
}
