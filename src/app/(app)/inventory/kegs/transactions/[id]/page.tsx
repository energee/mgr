"use client";

import { use } from "react";
import { EntityDetailUnified } from "@/components/universal/entity-detail-unified";
import { kegTransactionEntity } from "@/entities/keg-transaction";

export default function KegTransactionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <EntityDetailUnified
      entity={kegTransactionEntity}
      id={id}
      basePath="/inventory/kegs/transactions"
    />
  );
}
