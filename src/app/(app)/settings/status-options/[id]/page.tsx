"use client";

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { enumValueEntity } from "@/entities/enum-value";

export default function EnumValueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetail entity={enumValueEntity} id={id} basePath="/settings/status-options" />;
}
