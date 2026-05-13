"use client";

import { use } from "react";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { enumValueEntity } from "@/entities/enum-value";

export default function EnumValueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetailPage entity={enumValueEntity} id={id} basePath="/settings/status-options" />;
}
