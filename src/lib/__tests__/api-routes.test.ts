/**
 * API Route Tests
 *
 * Unit tests for API route logic: auth middleware behavior, request validation,
 * response helpers, and Zod schema validation for critical entities.
 *
 * These tests validate pure logic without requiring a running server or database.
 * Supabase client is mocked where needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// =============================================================================
// Mocks — must be set up before importing modules that use them
// =============================================================================

const mockGetUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: () => mockGetUser(),
    },
  }),
  createAdminClient: vi.fn().mockReturnValue({
    from: () => ({
      select: () => ({
        limit: () => Promise.resolve({ data: [{ table_name: "test" }], error: null }),
      }),
    }),
  }),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    child: () => ({
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    }),
  },
}));

import { withAuth } from "@/lib/api/auth";
import { successResponse, errorResponse, paginatedResponse } from "@/lib/api/response";
import { ApiError } from "@/lib/api/errors";
import { batchSchema } from "@/lib/schemas/batch";

// =============================================================================
// withAuth Middleware Tests
// =============================================================================

describe("withAuth middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when getUser returns an error", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: new Error("No session"),
    });

    const handler = vi.fn();
    const wrapped = withAuth(handler);

    const request = new NextRequest("http://localhost/api/test");
    const response = await wrapped(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.message).toBe("Authentication required");
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 401 when user is null (no session)", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const handler = vi.fn();
    const wrapped = withAuth(handler);

    const request = new NextRequest("http://localhost/api/test");
    const response = await wrapped(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls handler with user and supabase when authenticated", async () => {
    const mockUser = { id: "user-123", email: "test@brewery.com" };
    mockGetUser.mockResolvedValue({
      data: { user: mockUser },
      error: null,
    });

    const handler = vi.fn().mockResolvedValue(
      NextResponse.json({ data: "ok" }, { status: 200 })
    );
    const wrapped = withAuth(handler);

    const request = new NextRequest("http://localhost/api/test");
    const response = await wrapped(request);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);

    const [passedRequest, context] = handler.mock.calls[0];
    expect(passedRequest).toBe(request);
    expect(context.user).toEqual(mockUser);
    expect(context.supabase).toBeDefined();
  });

  it("passes resolved route params to handler", async () => {
    const mockUser = { id: "user-456", email: "brewer@brewery.com" };
    mockGetUser.mockResolvedValue({
      data: { user: mockUser },
      error: null,
    });

    const handler = vi.fn().mockResolvedValue(
      NextResponse.json({ data: "ok" }, { status: 200 })
    );
    const wrapped = withAuth(handler);

    const request = new NextRequest("http://localhost/api/batches/abc-123");
    const routeContext = {
      params: Promise.resolve({ id: "abc-123" }),
    };
    await wrapped(request, routeContext);

    const [, context] = handler.mock.calls[0];
    expect(context.params).toEqual({ id: "abc-123" });
  });

  it("catches handler errors and returns structured error response", async () => {
    const mockUser = { id: "user-789", email: "admin@brewery.com" };
    mockGetUser.mockResolvedValue({
      data: { user: mockUser },
      error: null,
    });

    const handler = vi.fn().mockRejectedValue(
      new ApiError("NOT_FOUND", "Batch not found", 404)
    );
    const wrapped = withAuth(handler);

    const request = new NextRequest("http://localhost/api/batches/nonexistent");
    const response = await wrapped(request);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toBe("Batch not found");
  });

  it("catches generic errors and returns 500", async () => {
    const mockUser = { id: "user-000", email: "test@brewery.com" };
    mockGetUser.mockResolvedValue({
      data: { user: mockUser },
      error: null,
    });

    const handler = vi.fn().mockRejectedValue(new Error("Database connection lost"));
    const wrapped = withAuth(handler);

    const request = new NextRequest("http://localhost/api/test");
    const response = await wrapped(request);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});

// =============================================================================
// Response Helper Tests
// =============================================================================

describe("successResponse", () => {
  it("returns 200 with data wrapper by default", async () => {
    const response = successResponse({ id: "batch-1", name: "IPA" });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data).toEqual({ id: "batch-1", name: "IPA" });
    expect(body.meta).toBeUndefined();
  });

  it("includes pagination meta when provided", async () => {
    const response = successResponse(
      [{ id: "1" }, { id: "2" }],
      { page: 1, per_page: 10, total: 42 }
    );

    const body = await response.json();
    expect(body.data).toHaveLength(2);
    expect(body.meta).toEqual({ page: 1, per_page: 10, total: 42 });
  });

  it("accepts custom status code", async () => {
    const response = successResponse({ id: "new-batch" }, undefined, 201);
    expect(response.status).toBe(201);
  });
});

describe("errorResponse", () => {
  it("returns structured error body", async () => {
    const response = errorResponse("VALIDATION_ERROR", "Invalid input", undefined, 422);
    expect(response.status).toBe(422);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("Invalid input");
  });

  it("includes details when provided", async () => {
    const details = [{ path: "name", message: "Required" }];
    const response = errorResponse("VALIDATION_ERROR", "Failed", details, 422);

    const body = await response.json();
    expect(body.error.details).toEqual(details);
  });

  it("omits details key when not provided", async () => {
    const response = errorResponse("NOT_FOUND", "Missing");

    const body = await response.json();
    expect(body.error).not.toHaveProperty("details");
  });

  it("defaults to 400 status when not specified", async () => {
    const response = errorResponse("VALIDATION_ERROR", "Bad request");
    expect(response.status).toBe(400);
  });
});

describe("paginatedResponse", () => {
  it("wraps data array with pagination meta", async () => {
    const items = [{ id: "1" }, { id: "2" }, { id: "3" }];
    const response = paginatedResponse(items, 2, 25, 100);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(3);
    expect(body.meta).toEqual({ page: 2, per_page: 25, total: 100 });
  });

  it("handles empty data array", async () => {
    const response = paginatedResponse([], 1, 10, 0);

    const body = await response.json();
    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(0);
  });
});

// =============================================================================
// Batch Schema Validation Tests
// =============================================================================

describe("batchSchema validation", () => {
  it("accepts valid batch data", () => {
    const result = batchSchema.safeParse({
      batch_code: "2024-001",
      name: "Hazy IPA #5",
      status: "planned",
      recipe_id: "550e8400-e29b-41d4-a716-446655440000",
      volume_bbl: 10,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.batch_code).toBe("2024-001");
      expect(result.data.name).toBe("Hazy IPA #5");
      expect(result.data.status).toBe("planned");
    }
  });

  it("accepts missing batch_code (auto-generated by database)", () => {
    const result = batchSchema.safeParse({
      name: "IPA",
    });

    expect(result.success).toBe(true);
  });

  it("accepts empty batch_code (auto-generated by database)", () => {
    const result = batchSchema.safeParse({
      batch_code: "",
      name: "IPA",
    });

    expect(result.success).toBe(true);
  });

  it("requires name", () => {
    const result = batchSchema.safeParse({
      batch_code: "2024-001",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("name");
    }
  });

  it("rejects empty name", () => {
    const result = batchSchema.safeParse({
      batch_code: "2024-001",
      name: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const nameIssue = result.error.issues.find((i) => i.path[0] === "name");
      expect(nameIssue?.message).toBe("Name is required");
    }
  });

  it("defaults status to 'planned' when not provided", () => {
    const result = batchSchema.safeParse({
      batch_code: "2024-001",
      name: "Pilsner",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("planned");
    }
  });

  it("accepts nullable optional fields as null", () => {
    const result = batchSchema.safeParse({
      batch_code: "2024-001",
      name: "Stout",
      recipe_id: null,
      planned_start_date: null,
      volume_bbl: null,
      actual_fg: null,
      actual_abv: null,
      notes: null,
    });

    expect(result.success).toBe(true);
  });

  it("accepts minimal valid data (only required fields)", () => {
    const result = batchSchema.safeParse({
      batch_code: "B001",
      name: "Test Batch",
    });

    expect(result.success).toBe(true);
  });

  it("rejects invalid UUID for recipe_id", () => {
    const result = batchSchema.safeParse({
      batch_code: "2024-001",
      name: "IPA",
      recipe_id: "not-a-uuid",
    });

    expect(result.success).toBe(false);
  });

  it("coerces string numbers for volume_bbl", () => {
    const result = batchSchema.safeParse({
      batch_code: "2024-001",
      name: "IPA",
      volume_bbl: "10.5",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.volume_bbl).toBe(10.5);
      expect(typeof result.data.volume_bbl).toBe("number");
    }
  });

  it("coerces string numbers for actual_fg and actual_abv", () => {
    const result = batchSchema.safeParse({
      batch_code: "2024-001",
      name: "IPA",
      actual_fg: "1.012",
      actual_abv: "6.5",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.actual_fg).toBe(1.012);
      expect(result.data.actual_abv).toBe(6.5);
    }
  });
});

// =============================================================================
// Order Schema Validation Tests
// =============================================================================

// Import orderSchema directly (it's co-located in the entity file which has
// React components, so we mock the supabase client above to prevent issues)
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

// Dynamic import to ensure mocks are applied first
const { orderSchema } = await import("@/entities/order");

describe("orderSchema validation", () => {
  it("accepts valid order data", () => {
    const result = orderSchema.safeParse({
      order_number: "ORD-2024-001",
      customer_id: "550e8400-e29b-41d4-a716-446655440000",
      status: "draft",
      order_date: "2024-06-15",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.order_number).toBe("ORD-2024-001");
      expect(result.data.status).toBe("draft");
    }
  });

  it("requires order_number", () => {
    const result = orderSchema.safeParse({
      order_date: "2024-06-15",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("order_number");
    }
  });

  it("rejects empty order_number", () => {
    const result = orderSchema.safeParse({
      order_number: "",
      order_date: "2024-06-15",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "order_number");
      expect(issue?.message).toBe("Order number is required");
    }
  });

  it("requires order_date", () => {
    const result = orderSchema.safeParse({
      order_number: "ORD-001",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("order_date");
    }
  });

  it("rejects empty order_date", () => {
    const result = orderSchema.safeParse({
      order_number: "ORD-001",
      order_date: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "order_date");
      expect(issue?.message).toBe("Order date is required");
    }
  });

  it("defaults status to 'draft' when not provided", () => {
    const result = orderSchema.safeParse({
      order_number: "ORD-001",
      order_date: "2024-06-15",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("draft");
    }
  });

  it("accepts nullable optional fields as null", () => {
    const result = orderSchema.safeParse({
      order_number: "ORD-001",
      order_date: "2024-06-15",
      customer_id: null,
      requested_date: null,
      scheduled_date: null,
      notes: null,
    });

    expect(result.success).toBe(true);
  });

  it("accepts minimal valid data (only required fields)", () => {
    const result = orderSchema.safeParse({
      order_number: "ORD-001",
      order_date: "2024-06-15",
    });

    expect(result.success).toBe(true);
  });

  it("rejects invalid UUID for customer_id", () => {
    const result = orderSchema.safeParse({
      order_number: "ORD-001",
      order_date: "2024-06-15",
      customer_id: "not-a-uuid",
    });

    expect(result.success).toBe(false);
  });
});

// =============================================================================
// Batch State Transition Validation (pure logic)
// =============================================================================

import {
  batchStates,
  batchTransitions,
  type BatchState,
} from "@/lib/schemas/batch";

describe("batch state transition validation (pure logic)", () => {
  /**
   * Validates whether a state transition is allowed according to the
   * transition map. This mirrors the validation logic used in API routes.
   */
  function isTransitionAllowed(from: string, to: string): boolean {
    const allowed = batchTransitions[from];
    return !!allowed && allowed.includes(to);
  }

  it("allows planned -> fermenting", () => {
    expect(isTransitionAllowed("planned", "fermenting")).toBe(true);
  });

  it("allows fermenting -> conditioning", () => {
    expect(isTransitionAllowed("fermenting", "conditioning")).toBe(true);
  });

  it("allows conditioning -> packaging", () => {
    expect(isTransitionAllowed("conditioning", "packaging")).toBe(true);
  });

  it("allows packaging -> completed", () => {
    expect(isTransitionAllowed("packaging", "completed")).toBe(true);
  });

  it("rejects skipping states (planned -> conditioning)", () => {
    expect(isTransitionAllowed("planned", "conditioning")).toBe(false);
  });

  it("rejects skipping states (planned -> packaging)", () => {
    expect(isTransitionAllowed("planned", "packaging")).toBe(false);
  });

  it("rejects skipping states (planned -> completed)", () => {
    expect(isTransitionAllowed("planned", "completed")).toBe(false);
  });

  it("rejects backward transitions (fermenting -> planned)", () => {
    expect(isTransitionAllowed("fermenting", "planned")).toBe(false);
  });

  it("rejects backward transitions (completed -> packaging)", () => {
    expect(isTransitionAllowed("completed", "packaging")).toBe(false);
  });

  it("rejects transitions from terminal states", () => {
    const terminalStates: BatchState[] = ["completed", "cancelled", "archived"];
    for (const terminal of terminalStates) {
      for (const target of batchStates) {
        if (target !== terminal) {
          expect(isTransitionAllowed(terminal, target)).toBe(false);
        }
      }
    }
  });

  it("rejects self-transitions for all states", () => {
    for (const state of batchStates) {
      expect(isTransitionAllowed(state, state)).toBe(false);
    }
  });

  it("rejects transitions to unknown states", () => {
    expect(isTransitionAllowed("planned", "unknown_state")).toBe(false);
  });

  it("rejects transitions from unknown states", () => {
    expect(isTransitionAllowed("unknown_state", "fermenting")).toBe(false);
  });

  it("exports all expected states", () => {
    expect(batchStates).toContain("planned");
    expect(batchStates).toContain("fermenting");
    expect(batchStates).toContain("conditioning");
    expect(batchStates).toContain("packaging");
    expect(batchStates).toContain("completed");
    expect(batchStates).toContain("cancelled");
    expect(batchStates).toContain("archived");
    expect(batchStates).toHaveLength(7);
  });

  it("has a transition entry for every defined state", () => {
    for (const state of batchStates) {
      expect(batchTransitions).toHaveProperty(state);
      expect(Array.isArray(batchTransitions[state])).toBe(true);
    }
  });
});
