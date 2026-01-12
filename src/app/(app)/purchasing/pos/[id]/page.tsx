"use client";

import { use } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { EntityDetail } from "@/components/universal/entity-detail";
import { purchaseOrderEntity } from "@/entities/purchase-order";
import { POReceiving } from "@/components/domain/po-receiving";

export default function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const supabase = createClient();

  // Fetch the PO to get status for the receiving component
  const { data: po } = useQuery({
    queryKey: ["purchase_orders", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_orders")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const handleReceiveComplete = () => {
    queryClient.invalidateQueries({ queryKey: ["purchase_orders", id] });
  };

  return (
    <EntityDetail
      entity={purchaseOrderEntity}
      id={id}
      basePath="/purchasing/pos"
      customActions={
        po?.status ? (
          <POReceiving
            poId={id}
            poStatus={po.status}
            onReceiveComplete={handleReceiveComplete}
          />
        ) : null
      }
    />
  );
}
