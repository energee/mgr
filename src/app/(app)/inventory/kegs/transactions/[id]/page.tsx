"use client";

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { kegTransactionEntity } from "@/entities/keg-transaction";

export default function KegTransactionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <EntityDetail
      entity={kegTransactionEntity}
      id={id}
      basePath="/inventory/kegs/transactions"
    />
  );
}
