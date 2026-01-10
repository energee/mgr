"use client";

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { customerEntity } from "@/entities/customer";

export default function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetail entity={customerEntity} id={id} basePath="/sales/customers" />;
}
