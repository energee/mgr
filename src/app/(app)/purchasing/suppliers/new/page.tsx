"use client";

import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { supplierEntity } from "@/entities/supplier";

export default function NewSupplierPage() {
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={supplierEntity}
      basePath="/purchasing/suppliers"
    />
  );
}
