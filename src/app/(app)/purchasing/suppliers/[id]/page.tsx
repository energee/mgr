"use client";

import { use } from "react";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { supplierEntity } from "@/entities/supplier";

export default function SupplierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetailUnifiedWithErrorBoundary entity={supplierEntity} id={id} basePath="/purchasing/suppliers" />;
}
