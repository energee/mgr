"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { salesChannelEntity } from "@/entities/sales-channel";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditSalesChannelPage({ params }: Props) {
  const { id } = await params;
  return <EntityForm entity={salesChannelEntity} id={id} basePath="/settings/sales-channels" />;
}
