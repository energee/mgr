import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/auth", () => ({
  withPermission:
    (_permission: string, handler: (request: Request, context: unknown) => unknown) =>
    (request: Request) => handler(request, { user: { id: "user-1" } }),
}));

vi.mock("@/integrations/mongodb/client", () => ({
  getMongoDb: vi.fn(),
  closeMongoClient: vi.fn(),
}));

vi.mock("@/integrations/mongodb/sync", () => ({
  syncAll: vi.fn(),
  syncPhase: vi.fn(),
  syncEntity: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
}));

import { getMongoDb } from "@/integrations/mongodb/client";
import { syncAll, syncEntity } from "@/integrations/mongodb/sync";
import { POST } from "../route";

const request = (body: unknown) => new Request("http://localhost/api/integrations/mongodb/sync", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getMongoDb).mockResolvedValue({} as never);
  vi.mocked(syncAll).mockResolvedValue([]);
});

describe("MongoDB sync route", () => {
  it("rejects the unsafe global clean path before running a sync", async () => {
    const response = await POST(request({ clean: true }) as never);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("UNSAFE_CLEAN_DISABLED");
    expect(syncAll).not.toHaveBeenCalled();
  });

  it("returns a non-success response when any result has failures or errors", async () => {
    vi.mocked(syncAll).mockResolvedValue([{
      entityType: "recipes",
      phase: 2,
      synced: 0,
      failed: 1,
      errors: [{
        mongoId: "recipe-1",
        error: "phase=2 entity=recipes operation=reconcile: constraint failed",
      }],
    }]);

    const response = await POST(request({}) as never);
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error.code).toBe("SYNC_PARTIAL_FAILURE");
    expect(body.error.details).toMatchObject({ totalSynced: 0, totalFailed: 1 });
  });

  it("accepts packaging_sessions as a supported single-entity sync", async () => {
    vi.mocked(syncEntity).mockResolvedValue({
      entityType: "packaging_sessions",
      phase: 4,
      synced: 1,
      failed: 0,
      errors: [],
    });

    const response = await POST(request({ entity: "packaging_sessions" }) as never);

    expect(response.status).toBe(200);
    expect(syncEntity).toHaveBeenCalledWith("packaging_sessions");
  });

  it("rejects malformed request fields instead of coercing them", async () => {
    const response = await POST(request({ phase: "2", clean: "false" }) as never);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_SYNC_REQUEST");
    expect(syncAll).not.toHaveBeenCalled();
  });
});
