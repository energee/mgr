"use client";

import { EntityList } from "@/components/universal/entity-list";
import { binEntity } from "@/entities/bin";

export default function BinsPage() {
  return <EntityList entity={binEntity} basePath="/inventory/bins" />;
}
