/**
 * Route-level loading skeleton for /production/batches (sitewide loading
 * pattern). Shows during the server prefetch in page.tsx; the hydrated client
 * renders with the list already in cache, so no second skeleton flashes.
 * Columns mirror the table (5 list columns + actions), hardcoded so this
 * stays a Server Component — importing the assembled batchEntity (a client
 * module) would pull presentation JSX into the loading chunk just to read a
 * length. Rows stay at the kit's fold-capped default, matching the table's
 * own loading state.
 */
import { ListSkeleton } from "@/components/ui/skeletons";

export default function Loading() {
  return <ListSkeleton columns={6} />;
}
