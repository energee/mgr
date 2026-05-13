"use client";

import { use } from "react";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { supplierEntity } from "@/entities/supplier";

export default function SupplierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetailPage entity={supplierEntity} id={id} basePath="/purchasing/suppliers" />;
}
