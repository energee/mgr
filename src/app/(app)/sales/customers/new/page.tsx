"use client";

import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { customerEntity } from "@/entities/customer";

export default function NewCustomerPage() {
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={customerEntity}
      basePath="/sales/customers"
    />
  );
}
