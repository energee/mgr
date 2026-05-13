"use client";

import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { supplierEntity } from "@/entities/supplier";

export default function NewSupplierPage() {
  return (
    <EntityDetailPage
      entity={supplierEntity}
      basePath="/purchasing/suppliers"
    />
  );
}
