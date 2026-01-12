"use client";

import { use } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { supplierEntity } from "@/entities/supplier";

export default function EditSupplierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityForm entity={supplierEntity} id={id} basePath="/purchasing/suppliers" />;
}
