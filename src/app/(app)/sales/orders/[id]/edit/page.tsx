"use client";

import { use } from "react";
import { OrderForm } from "@/components/domain/order-form";

export default function EditOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <OrderForm id={id} />;
}
