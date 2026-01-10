"use client";

import { use } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { customerEntity } from "@/entities/customer";

export default function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityForm entity={customerEntity} id={id} basePath="/sales/customers" />;
}
