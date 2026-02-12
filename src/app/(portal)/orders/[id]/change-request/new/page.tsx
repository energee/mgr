"use client";
import { use } from "react";
import { ChangeRequestBuilder } from "@/components/portal/change-request-builder";

export default function NewChangeRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <ChangeRequestBuilder orderId={id} />;
}
