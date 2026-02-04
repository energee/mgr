"use client";

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { locationTransferEntity } from "@/entities/location-transfer";

export default function TransferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetail entity={locationTransferEntity} id={id} basePath="/inventory/transfers" />;
}
