/**
 * Tests for the /api/health route handler.
 *
 * Mocks the Supabase admin client to verify:
 * - 200 "ok" when database is reachable
 * - 503 "degraded" when the database query returns an error
 * - 503 "degraded" when createAdminClient throws an exception
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock Supabase admin client
// ---------------------------------------------------------------------------

const mockSelect = vi.fn();
const mockLimit = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: (...args: unknown[]) => {
        mockSelect(...args);
        return { limit: mockLimit };
      },
    }),
  }),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    child: () => ({
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { GET } from "@/app/api/health/route";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("/api/health GET", () => {
  beforeEach(() => {
    mockSelect.mockReset();
    mockLimit.mockReset();
  });

  it("returns 200 ok when database is reachable", async () => {
    mockLimit.mockResolvedValueOnce({ data: [{ table_name: "batches" }], error: null });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.database).toBe("connected");
    expect(mockSelect).toHaveBeenCalledWith("table_name");
  });

  it("returns 503 degraded when database query returns an error", async () => {
    mockLimit.mockResolvedValueOnce({
      data: null,
      error: { message: "connection refused" },
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.database).toBe("unreachable");
  });

  it("returns 503 degraded when an exception is thrown", async () => {
    mockLimit.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.database).toBe("unreachable");
  });
});
