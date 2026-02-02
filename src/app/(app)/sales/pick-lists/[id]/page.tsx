"use client";

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { pickListEntity } from "@/entities/pick-list";

export default function PickListDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetail entity={pickListEntity} id={id} basePath="/sales/pick-lists" />;
}
