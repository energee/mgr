"use client";

/** Inventory routes error boundary. */

import { RouteError } from "@/components/universal/route-error";

export default function InventoryError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} domain="inventory" />;
}
