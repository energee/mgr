"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { binEntity } from "@/entities/bin";

export default function NewBinPage() {
  return <EntityForm entity={binEntity} basePath="/inventory/bins" />;
}
