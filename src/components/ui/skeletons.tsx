/**
 * Shared skeleton kit for the sitewide loading pattern
 * (see docs/plans/2026-07-15-sitewide-loading-pattern.md).
 *
 * One place to define the loading shapes so every route's loading.tsx and any
 * client fallback render the SAME skeleton — no per-page bespoke blocks, and no
 * mismatched double-flash. As pages adopt server prefetch + hydration, their
 * route loading.tsx renders the matching skeleton here and the client no longer
 * shows a second one.
 */
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Table/list loading shape: an optional toolbar row plus `rows` × `columns`.
 * `bordered: false` drops the outer border for hosts that already draw one
 * (e.g. a relation table inside a Card).
 */
export function ListSkeleton({
  rows = 8,
  columns = 5,
  toolbar = true,
  bordered = true,
}: {
  rows?: number;
  columns?: number;
  toolbar?: boolean;
  bordered?: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col gap-4">
      {toolbar && (
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-9 w-24" />
        </div>
      )}
      <div className={bordered ? "rounded-lg border" : undefined}>
        <div className="divide-y">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-3">
              {Array.from({ length: columns }).map((_, j) => (
                <Skeleton
                  key={j}
                  className="h-4 flex-1"
                  style={{ animationDelay: `${i * 60}ms` }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Dashboard loading shape: title row, two-column section grid, stat tiles, and
 * chart boxes — mirrors the /dashboard* card-grid layout (heights match the
 * pages' own section skeletons so the route fallback → page swap doesn't jump).
 */
export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-5 w-40" />
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <Skeleton className="h-64 rounded-lg lg:col-span-3" />
        <Skeleton className="h-64 rounded-lg lg:col-span-2" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[88px] rounded-lg" />
        ))}
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-[248px] rounded-lg" />
        ))}
      </div>
    </div>
  );
}

/** Detail-page loading shape: header block + `sections` field grids. */
export function DetailSkeleton({ sections = 3 }: { sections?: number }) {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-9 w-32" />
      </div>
      {Array.from({ length: sections }).map((_, s) => (
        <div key={s} className="grid gap-4 rounded-lg border p-4">
          <Skeleton className="h-5 w-40" />
          <div className="grid grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-5 w-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
