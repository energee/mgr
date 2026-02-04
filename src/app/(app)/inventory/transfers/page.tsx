"use client";

import { EntityList } from "@/components/universal/entity-list";
import { locationTransferEntity } from "@/entities/location-transfer";

export default function TransfersPage() {
  return <EntityList entity={locationTransferEntity} basePath="/inventory/transfers" />;
}
