/**
 * Square locations refresh route tests (Milestone C3).
 *
 * Exercises the real listSquareLocations normalization (only getSquareClient is
 * mocked, via importActual) through the POST /api/square/locations/refresh
 * handler with a mocked Square client and a small in-memory admin builder:
 *   - disabled integration -> 400 INTEGRATION_DISABLED, no upsert;
 *   - normalizes locations.list -> square_locations rows (skips id-less entries,
 *     preserves null name / status), upserts onConflict square_location_id with
 *     a synced_at stamp (upsert-only — no deletes);
 *   - empty list -> count 0, no upsert.
 *
 * withPermission is stubbed to a pass-through per the repo idiom (see
 * src/app/api/square/sync/__tests__/sync-routes.test.ts).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/api/auth", () => ({
  withPermission:
    (_perm: string, handler: (req: unknown, ctx: unknown) => unknown) =>
    (req: unknown) =>
      handler(req, { user: { id: "user-1" } }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
}));

// Keep the real listSquareLocations (normalization under test); mock only the
// client factory so no real Square SDK client is constructed.
vi.mock("@/integrations/square/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/integrations/square/client")>();
  return { ...actual, getSquareClient: vi.fn() };
});

import { createAdminClient } from "@/lib/supabase/server";
import { getSquareClient } from "@/integrations/square/client";
import { POST } from "@/app/api/square/locations/refresh/route";

const mockedCreateAdminClient = vi.mocked(createAdminClient);
const mockedGetSquareClient = vi.mocked(getSquareClient);

// Capture upsert calls from the in-memory admin builder.
const upserts: Array<{ table: string; rows: unknown; opts: unknown }> = [];

function makeAdmin() {
  return {
    from(table: string) {
      return {
        upsert: (rows: unknown, opts: unknown) => {
          upserts.push({ table, rows, opts });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

/** A fake SquareClient whose locations.list resolves to the given raw locations. */
function fakeClient(locations: unknown[]) {
  return { locations: { list: async () => ({ locations }) } } as never;
}

const req = () => new NextRequest("http://localhost/api/square/locations/refresh");

beforeEach(() => {
  vi.clearAllMocks();
  upserts.length = 0;
  mockedCreateAdminClient.mockImplementation(
    async () => makeAdmin() as unknown as Awaited<ReturnType<typeof createAdminClient>>
  );
});

describe("POST /api/square/locations/refresh", () => {
  it("returns INTEGRATION_DISABLED when Square is not connected", async () => {
    mockedGetSquareClient.mockResolvedValue(null);
    const res = await POST(req());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INTEGRATION_DISABLED");
    expect(upserts).toHaveLength(0);
  });

  it("normalizes and upserts locations (skips id-less, preserves null name/status)", async () => {
    mockedGetSquareClient.mockResolvedValue(
      fakeClient([
        { id: "SQ-LOC-1", name: "Taproom", status: "ACTIVE" },
        { id: "SQ-LOC-2", name: null, status: "INACTIVE" }, // null name preserved
        { name: "No Id — skipped" }, // no id -> dropped (id is the PK)
      ])
    );

    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.count).toBe(2);

    expect(upserts).toHaveLength(1);
    const { table, rows, opts } = upserts[0];
    expect(table).toBe("square_locations");
    expect(opts).toEqual({ onConflict: "square_location_id" });
    expect(rows).toEqual([
      { square_location_id: "SQ-LOC-1", name: "Taproom", status: "ACTIVE", synced_at: expect.any(String) },
      { square_location_id: "SQ-LOC-2", name: null, status: "INACTIVE", synced_at: expect.any(String) },
    ]);
  });

  it("does not upsert when Square returns no locations", async () => {
    mockedGetSquareClient.mockResolvedValue(fakeClient([]));
    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.count).toBe(0);
    expect(upserts).toHaveLength(0);
  });
});
