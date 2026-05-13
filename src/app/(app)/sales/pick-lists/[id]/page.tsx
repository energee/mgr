"use client";

import { use } from "react";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { pickListEntity } from "@/entities/pick-list";

export default function PickListDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetailPage entity={pickListEntity} id={id} basePath="/sales/pick-lists" />;
}
