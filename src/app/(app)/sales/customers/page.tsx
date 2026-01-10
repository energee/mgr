"use client";

import { EntityList } from "@/components/universal/entity-list";
import { customerEntity } from "@/entities/customer";

export default function CustomersPage() {
  return <EntityList entity={customerEntity} basePath="/sales/customers" />;
}
