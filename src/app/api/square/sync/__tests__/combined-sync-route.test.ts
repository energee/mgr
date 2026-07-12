/**
 * Square combined sync route tests (audit SEC-1, backlog P2 #20).
 *
 * Locks in that the combined /api/square/sync route invokes the catalog and
 * inventory sync handlers DIRECTLY as functions instead of HTTP self-fetching
 * `${new URL(request.url).origin}/api/square/sync/*` with the caller's cookie
 * forwarded. The old origin derived from request.url trusts the incoming Host
 * header, so on a deployment that doesn't strictly validate Host a spoofed
 * header could redirect the loopback call — session cookie included — to an
 * attacker-chosen origin. Every test here runs with a hostile Host and a
 * fetch spy that throws: any regression back to a self-fetch fails loudly.
 *
 * withPermission is stubbed to a pass-through; the sibling route modules are
 * mocked entirely so only the combined route's orchestration (sequencing,
 * error mapping, partial-success shape) is exercised.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// -----------------------------------------------------------------------------
// Mocks (must precede route imports)
// -----------------------------------------------------------------------------

vi.mock("@/lib/api/auth", () => ({
  withPermission:
    (_perm: string, handler: (req: unknown, ctx: unknown) => unknown) =>
    (req: unknown) =>
      handler(req, { user: { id: "user-1" } }),
}));

vi.mock("@/app/api/square/sync/catalog/route", () => ({ POST: vi.fn() }));
vi.mock("@/app/api/square/sync/inventory/route", () => ({ POST: vi.fn() }));

import { POST as catalogPOST } from "@/app/api/square/sync/catalog/route";
import { POST as inventoryPOST } from "@/app/api/square/sync/inventory/route";
import { POST as combinedPOST } from "@/app/api/square/sync/route";

const mockedCatalog = vi.mocked(catalogPOST);
const mockedInventory = vi.mocked(inventoryPOST);

/**
 * A request whose Host header (via request.url) is attacker-controlled — the
 * old self-fetch would have built its loopback origin from this and forwarded
 * the session cookie to it.
 */
const req = () =>
  new NextRequest("http://attacker.example/api/square/sync", {
    method: "POST",
    headers: { cookie: "sb-session=secret" },
  });

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  // Any outbound HTTP from the combined route is a regression to the
  // Host-derived self-fetch — make it loud AND assertable.
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    throw new Error("unexpected outbound fetch from combined sync route");
  });
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe("combined sync route (function invocation, no self-fetch)", () => {
  it("invokes both sync handlers as functions with the caller's request — never an HTTP self-fetch derived from request headers", async () => {
    mockedCatalog.mockResolvedValue(NextResponse.json({ data: { itemsSynced: 3 } }));
    mockedInventory.mockResolvedValue(NextResponse.json({ data: { totalSynced: 2 } }));

    const request = req();
    const res = await combinedPOST(request);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      catalog: { itemsSynced: 3 },
      inventory: { totalSynced: 2 },
    });

    // Direct function invocation with the IDENTICAL request object (each
    // sibling handler runs its own withPermission gate against it)...
    expect(mockedCatalog).toHaveBeenCalledTimes(1);
    expect(mockedCatalog).toHaveBeenCalledWith(request);
    expect(mockedInventory).toHaveBeenCalledTimes(1);
    expect(mockedInventory).toHaveBeenCalledWith(request);

    // ...and zero outbound HTTP — nothing for a spoofed Host to redirect.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps a failed catalog sync to CATALOG_SYNC_FAILED with the inner status and never runs inventory", async () => {
    mockedCatalog.mockResolvedValue(
      NextResponse.json(
        { error: { code: "CONFIGURATION_ERROR", message: "No bins configured" } },
        { status: 400 }
      )
    );

    const res = await combinedPOST(req());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("CATALOG_SYNC_FAILED");
    expect(body.error.message).toBe("No bins configured");
    expect(mockedInventory).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns partial success (200) when inventory sync fails after catalog succeeded", async () => {
    mockedCatalog.mockResolvedValue(NextResponse.json({ data: { itemsSynced: 1 } }));
    mockedInventory.mockResolvedValue(
      NextResponse.json({ error: { code: "SYNC_FAILED", message: "boom" } }, { status: 500 })
    );

    const res = await combinedPOST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.catalog).toEqual({ itemsSynced: 1 });
    expect(body.data.inventory).toEqual({ success: false, error: "boom" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps a rejected catalog handler to CATALOG_SYNC_FAILED 500, and a rejected inventory handler to partial success", async () => {
    mockedCatalog.mockRejectedValue(new Error("catalog exploded"));
    const res1 = await combinedPOST(req());
    expect(res1.status).toBe(500);
    const body1 = await res1.json();
    expect(body1.error.code).toBe("CATALOG_SYNC_FAILED");
    expect(body1.error.message).toBe("catalog exploded");

    mockedCatalog.mockResolvedValue(NextResponse.json({ data: { itemsSynced: 1 } }));
    mockedInventory.mockRejectedValue(new Error("inventory exploded"));
    const res2 = await combinedPOST(req());
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.data.inventory).toEqual({ success: false, error: "inventory exploded" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
