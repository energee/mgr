"use client";

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { binEntity } from "@/entities/bin";

export default function BinDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetail entity={binEntity} id={id} basePath="/inventory/bins" />;
}
