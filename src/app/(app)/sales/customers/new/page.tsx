"use client";

import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { customerEntity } from "@/entities/customer";

export default function NewCustomerPage() {
  return (
    <EntityDetailPage
      entity={customerEntity}
      basePath="/sales/customers"
    />
  );
}
