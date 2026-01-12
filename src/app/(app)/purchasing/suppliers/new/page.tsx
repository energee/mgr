"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { supplierEntity } from "@/entities/supplier";

export default function NewSupplierPage() {
  return <EntityForm entity={supplierEntity} basePath="/purchasing/suppliers" />;
}
