"use client";

import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { kegOwnerEntity } from "@/entities/keg-owner";

export default function NewKegOwnerPage() {
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={kegOwnerEntity}
      basePath="/inventory/kegs/owners"
    />
  );
}
