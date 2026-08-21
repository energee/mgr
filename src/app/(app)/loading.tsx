/**
 * App Loading Boundary
 *
 * Shown while route segments within the authenticated app are loading.
 * Renders the shared ListSkeleton (most app routes are list pages); routes
 * with a different shape (dashboards, details) override with their own
 * loading.tsx. No padding wrapper — ChatLayout already pads page content.
 */

import { ListSkeleton } from "@/components/ui/skeletons";

export default function AppLoading() {
  return <ListSkeleton rows={25} />;
}
