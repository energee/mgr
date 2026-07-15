"use client";

/**
 * Route-level loading skeleton for /settings/brands (sitewide loading pattern).
 * Shows during the server prefetch in page.tsx; the hydrated client then renders
 * with data already in cache, so no second skeleton flashes.
 *
 * "use client" so it can read the column count from the assembled `brandEntity`
 * (a client module); a Server Component can't import it.
 */
import { ListSkeleton } from "@/components/ui/skeletons";
import { brandEntity } from "@/entities/brand";

export default function Loading() {
  return <ListSkeleton columns={brandEntity.listColumns.length} />;
}
