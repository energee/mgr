/**
 * Route-level loading skeleton for /settings/brands (sitewide loading pattern).
 * Shows during the server prefetch in page.tsx; the hydrated client then renders
 * with data already in cache, so no second skeleton flashes.
 *
 * Column count (5 list columns + actions) is hardcoded so this stays a Server
 * Component — the previous version was "use client" and imported the whole
 * assembled brandEntity (presentation JSX and its dependency tree) into the
 * loading chunk just to read listColumns.length.
 */
import { ListSkeleton } from "@/components/ui/skeletons";

export default function Loading() {
  return <ListSkeleton columns={6} />;
}
