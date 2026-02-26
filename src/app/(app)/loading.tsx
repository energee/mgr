import { Skeleton } from "@/components/ui/skeleton";

/**
 * App-wide loading skeleton.
 * Displayed by Next.js Suspense while page components are loading.
 */
export default function AppLoading() {
  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Page title skeleton */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96" />
      </div>

      {/* Content area skeleton */}
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
