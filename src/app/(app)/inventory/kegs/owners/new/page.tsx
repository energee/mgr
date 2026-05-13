"use client";

import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { kegOwnerEntity } from "@/entities/keg-owner";

export default function NewKegOwnerPage() {
  return (
    <EntityDetailPage
      entity={kegOwnerEntity}
      basePath="/inventory/kegs/owners"
    />
  );
}
