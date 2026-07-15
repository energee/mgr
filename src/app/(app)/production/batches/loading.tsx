/**
 * Batches route loading boundary — intentionally renders nothing.
 *
 * The batches list is a client page whose table (EntityList → entity-data-table)
 * already renders its own skeleton while React Query fetches. Without this file,
 * the app-level `src/app/(app)/loading.tsx` skeleton also shows during segment
 * streaming, so a cold-cache visit flashed TWO different skeletons back to back.
 * Overriding the parent boundary here with an empty fallback leaves only the
 * table's own skeleton.
 */
export default function BatchesLoading() {
  return null;
}
