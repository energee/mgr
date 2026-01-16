"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { salesChannelEntity } from "@/entities/sales-channel";

export default function NewSalesChannelPage() {
  return <EntityForm entity={salesChannelEntity} basePath="/settings/sales-channels" />;
}
