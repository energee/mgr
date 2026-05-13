"use client";

import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { locationTransferEntity } from "@/entities/location-transfer";

export default function NewTransferPage() {
  return (
    <EntityDetailPage
      entity={locationTransferEntity}
      basePath="/inventory/transfers"
    />
  );
}
