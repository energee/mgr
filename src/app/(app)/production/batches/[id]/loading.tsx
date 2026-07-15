/**
 * Route-level loading skeleton for /production/batches/[id] (sitewide loading
 * pattern). Shows during the server detail prefetch in page.tsx; the hydrated
 * client then renders with the record already in cache, so no second skeleton
 * flashes. DetailSkeleton needs no entity config, so this stays a plain module.
 */
import { DetailSkeleton } from "@/components/ui/skeletons";

export default function Loading() {
  return <DetailSkeleton />;
}
