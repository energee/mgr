"use client";

import { use } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { salesChannelEntity } from "@/entities/sales-channel";

export default function EditSalesChannelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityForm entity={salesChannelEntity} id={id} basePath="/settings/sales-channels" />;
}
