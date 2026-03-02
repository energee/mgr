"use client";

import { EntityList } from "@/components/universal/entity-list";
import { pickListEntity } from "@/entities/pick-list";

export default function PickListsPage() {
  return <EntityList entity={pickListEntity} basePath="/sales/pick-lists" showCreate={false} />;
}
