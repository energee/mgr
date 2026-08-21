/**
 * Route-level loading skeleton for /production/batches (sitewide loading
 * pattern). Shows during the server prefetch in page.tsx; the hydrated client
 * renders with the list already in cache, so no second skeleton flashes.
 * rows/columns mirror the table's first page (default page size 25; 5 list
 * columns + actions). Counts are hardcoded so this stays a Server Component —
 * importing the assembled batchEntity (a client module) would pull
 * presentation JSX into the loading chunk just to read two lengths.
 */
import { ListSkeleton } from "@/components/ui/skeletons";

export default function Loading() {
  return <ListSkeleton rows={25} columns={6} />;
}
