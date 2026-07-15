"use client";

/**
 * Route-level loading skeleton for /production/batches (sitewide loading
 * pattern). Shows during the server prefetch in page.tsx; the hydrated client
 * then renders with data already in cache, so no second skeleton flashes.
 *
 * Marked "use client" so it can read column count from the assembled
 * `batchEntity` (a client module); a Server Component can't import it.
 */
import { ListSkeleton } from "@/components/ui/skeletons";
import { batchEntity } from "@/entities/batch";

export default function Loading() {
  return <ListSkeleton columns={batchEntity.listColumns.length} />;
}
