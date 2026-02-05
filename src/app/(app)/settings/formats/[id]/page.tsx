"use client";

import { use } from "react";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { packageTypeEntity } from "@/entities/package-type";

export default function PackageTypeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetailUnifiedWithErrorBoundary entity={packageTypeEntity} id={id} basePath="/settings/formats" />;
}
