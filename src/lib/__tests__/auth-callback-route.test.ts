/**
 * Tests for the /api/auth/callback route handler.
 *
 * Mocks the Supabase client to verify:
 * - Successful code exchange redirects to the specified path
 * - Open redirect prevention for malicious redirect params
 * - Error handling when code exchange fails
 * - Missing code parameter redirects to login with error
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mock Supabase client
// ---------------------------------------------------------------------------

const mockExchangeCodeForSession = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      exchangeCodeForSession: mockExchangeCodeForSession,
    },
  }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { GET } from "@/app/api/auth/callback/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(params: Record<string, string>): NextRequest {
  const url = new URL("http://localhost:3000/api/auth/callback");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("/api/auth/callback GET", () => {
  beforeEach(() => {
    mockExchangeCodeForSession.mockReset();
  });

  it("redirects to / on successful code exchange with no redirect param", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });

    const response = await GET(makeRequest({ code: "test-code" }));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/");
    expect(mockExchangeCodeForSession).toHaveBeenCalledWith("test-code");
  });

  it("redirects to the specified path on success", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });

    const response = await GET(
      makeRequest({ code: "test-code", redirect: "/production/batches" })
    );

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe(
      "/production/batches"
    );
  });

  it("prevents open redirect with protocol in path", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });

    const response = await GET(
      makeRequest({ code: "test-code", redirect: "https://evil.com/steal" })
    );

    // Should redirect to / instead of the malicious URL
    expect(new URL(response.headers.get("location")!).pathname).toBe("/");
  });

  it("prevents open redirect with double slashes", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });

    const response = await GET(
      makeRequest({ code: "test-code", redirect: "//evil.com" })
    );

    expect(new URL(response.headers.get("location")!).pathname).toBe("/");
  });

  it("prevents open redirect with embedded protocol", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });

    const response = await GET(
      makeRequest({
        code: "test-code",
        redirect: "/redir?url=http://evil.com",
      })
    );

    // Contains :// so should be rejected
    expect(new URL(response.headers.get("location")!).pathname).toBe("/");
  });

  it("redirects to login with error when code exchange fails", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({
      error: { message: "invalid code" },
    });

    const response = await GET(makeRequest({ code: "bad-code" }));
    const location = new URL(response.headers.get("location")!);

    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("auth_callback_error");
  });

  it("redirects to login with error when no code is provided", async () => {
    const response = await GET(makeRequest({}));
    const location = new URL(response.headers.get("location")!);

    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("auth_callback_error");
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("redirects to login with error when code is empty string", async () => {
    const response = await GET(makeRequest({ code: "" }));
    const location = new URL(response.headers.get("location")!);

    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("auth_callback_error");
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("preserves redirect path with query parameters on success", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });

    const response = await GET(
      makeRequest({
        code: "test-code",
        redirect: "/production/batches?status=active",
      })
    );

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/production/batches");
    expect(location.searchParams.get("status")).toBe("active");
  });

  it("prevents redirect with javascript: protocol variant", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });

    const response = await GET(
      makeRequest({ code: "test-code", redirect: "javascript:alert(1)" })
    );

    // Does not start with / so isValidRedirect returns false
    expect(new URL(response.headers.get("location")!).pathname).toBe("/");
  });

  it("does not call exchangeCodeForSession when code is missing", async () => {
    await GET(makeRequest({ redirect: "/dashboard" }));

    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("ignores redirect param when code exchange fails", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({
      error: { message: "expired code" },
    });

    const response = await GET(
      makeRequest({ code: "expired", redirect: "/production/batches" })
    );
    const location = new URL(response.headers.get("location")!);

    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("auth_callback_error");
  });
});
