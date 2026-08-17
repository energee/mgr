/**
 * Portal order-placement route (Phase 4, node C2).
 *
 * Renders the customer-facing order builder at `/portal/orders/new`. All state,
 * availability capping and the RLS-constrained insert live in `OrderBuilder`;
 * this file only owns the route position.
 */
"use client";

import { OrderBuilder } from "@/components/portal/order-builder";

export default function NewPortalOrderPage() {
  return <OrderBuilder />;
}
