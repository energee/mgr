"use client";

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { supplierEntity } from "@/entities/supplier";

export default function SupplierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetail entity={supplierEntity} id={id} basePath="/purchasing/suppliers" />;
}
