"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { locationTransferEntity } from "@/entities/location-transfer";

export default function NewTransferPage() {
  return <EntityForm entity={locationTransferEntity} basePath="/inventory/transfers" />;
}
