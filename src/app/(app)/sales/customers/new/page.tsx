"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { customerEntity } from "@/entities/customer";

export default function NewCustomerPage() {
  return <EntityForm entity={customerEntity} basePath="/sales/customers" />;
}
