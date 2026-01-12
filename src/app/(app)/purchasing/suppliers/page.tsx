"use client";

import { EntityList } from "@/components/universal/entity-list";
import { supplierEntity } from "@/entities/supplier";

export default function SuppliersPage() {
  return <EntityList entity={supplierEntity} basePath="/purchasing/suppliers" />;
}
