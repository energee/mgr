/**
 * Route-level loading skeleton for /dashboard segments (production, sales,
 * inventory). Overrides the app-level list-shaped fallback with the shared
 * dashboard shape (title row + section grid + stat tiles + chart boxes) so the
 * fallback matches the card-grid layout these pages render.
 */
import { DashboardSkeleton } from "@/components/ui/skeletons";

export default function Loading() {
  return <DashboardSkeleton />;
}
