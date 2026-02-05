"use client";

import { use } from "react";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { enumValueEntity } from "@/entities/enum-value";

export default function EnumValueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetailUnifiedWithErrorBoundary entity={enumValueEntity} id={id} basePath="/settings/status-options" />;
}
