/**
 * Route-level loading skeleton for /dashboard/inventory. Overrides the parent
 * dashboard fallback's 3-tile/2-chart trends shape with this page's own
 * 2-tile/1-chart shape (see InventoryTrendsSkeleton in page.tsx).
 */
import { DashboardSkeleton } from "@/components/ui/skeletons";

export default function Loading() {
  return <DashboardSkeleton tiles={2} charts={1} />;
}
