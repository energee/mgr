"use client";

import { use } from "react";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { binEntity } from "@/entities/bin";

export default function BinDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetailPage entity={binEntity} id={id} basePath="/inventory/bins" />;
}
