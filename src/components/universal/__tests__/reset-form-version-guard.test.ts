/**
 * resetFormFromRecord must never let the tracked optimistic-lock version
 * (loadedVersionRef) regress.
 *
 * The save handler in entity-detail-unified.tsx advances loadedVersionRef
 * immediately from the server-confirmed row on a successful save, but
 * `setEditing(false)` flips in the same render as that save's cache
 * invalidation kicks off — before the resulting background refetch
 * resolves. The `data`-driven effect (dependency: [data, form, formDefaults,
 * editing]) fires on that render too, and until this fix it unconditionally
 * called resetFormFromRecord with whatever the query cache still held: the
 * pre-save record. That stomped loadedVersionRef back down to the version
 * the server already moved past, so an immediate second save reused the
 * stale version in its `.eq("version", ...)` check, matched zero rows, and
 * surfaced "Record was modified by another user" even though no one else
 * had touched it.
 */
import { describe, expect, it, vi } from "vitest";

// entity-detail-unified imports @/lib/supabase/client at module top level,
// which runs env validation on import (see docs/agents/gotchas.md).
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ from: () => ({ select: () => ({ data: [], error: null }) }) }),
}));
vi.mock("@/lib/client-logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { resetFormFromRecord } from "@/components/universal/entity-detail-unified";
import type { UseFormReturn } from "react-hook-form";

function fakeForm(): UseFormReturn<Record<string, unknown>> {
  return { reset: vi.fn() } as unknown as UseFormReturn<Record<string, unknown>>;
}

describe("resetFormFromRecord — optimistic-lock version tracking", () => {
  it("adopts the version on first load", () => {
    const ref = { current: null as number | null };
    const idRef = { current: null as string | null };
    resetFormFromRecord(fakeForm(), { id: "1", version: 5 }, {}, ref, idRef);
    expect(ref.current).toBe(5);
  });

  it("advances the ref when a fresher record arrives", () => {
    const ref = { current: 5 as number | null };
    const idRef = { current: "1" as string | null };
    resetFormFromRecord(fakeForm(), { id: "1", version: 6 }, {}, ref, idRef);
    expect(ref.current).toBe(6);
  });

  it("does not regress the ref when a stale cached record arrives after a save already advanced it", () => {
    // Simulates the save handler advancing the ref to the server-confirmed
    // version (6) immediately, then the data-driven effect re-firing with
    // the still-stale query cache (version 5) before its refetch resolves.
    const ref = { current: 6 as number | null };
    const idRef = { current: "1" as string | null };
    resetFormFromRecord(fakeForm(), { id: "1", version: 5 }, {}, ref, idRef);
    expect(ref.current).toBe(6);
  });

  it("leaves the ref untouched when the record has no numeric version", () => {
    const ref = { current: 3 as number | null };
    const idRef = { current: "1" as string | null };
    resetFormFromRecord(fakeForm(), { id: "1" }, {}, ref, idRef);
    expect(ref.current).toBe(3);
  });

  it("adopts a lower version when a genuinely different record loads", () => {
    // The component instance is reused across a navigation between two
    // different records of the same entity (e.g. clicking a related-record
    // link) without unmounting, so loadedVersionRef and loadedRecordIdRef
    // both persist. Record A had version 10; record B — a different row —
    // has version 3. The monotonic guard exists to stop a *stale cache read
    // of the same record* from undoing a just-completed save, not to pin
    // the ref to whatever the highest version ever seen was. Without an
    // id check, the guard blocked the drop to 3, and the next save on
    // record B sent version 10 in its `.eq("version", 10)` check — matching
    // zero rows and falsely reporting "Record was modified by another user"
    // on a record nobody had touched.
    const ref = { current: 10 as number | null };
    const idRef = { current: "record-a" as string | null };
    resetFormFromRecord(fakeForm(), { id: "record-b", version: 3 }, {}, ref, idRef);
    expect(ref.current).toBe(3);
    expect(idRef.current).toBe("record-b");
  });
});
