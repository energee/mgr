"use client";

import { use } from "react";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { kegTransactionEntity } from "@/entities/keg-transaction";

export default function KegTransactionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <EntityDetailPage
      entity={kegTransactionEntity}
      id={id}
      basePath="/inventory/kegs/transactions"
    />
  );
}
