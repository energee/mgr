/**
 * Token-hash email confirmation route tests.
 *
 * Supabase's default implicit magic-link redirect puts the session in a URL
 * fragment, which a server route cannot read. The hosted email template sends
 * token_hash here instead so verifyOtp can create cookie-backed SSR sessions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockVerifyOtp = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { verifyOtp: mockVerifyOtp },
  }),
}));

import { GET } from "@/app/api/auth/confirm/route";

function request(params: Record<string, string>) {
  const url = new URL("https://brewery.example/api/auth/confirm");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url);
}

beforeEach(() => {
  mockVerifyOtp.mockReset();
});

describe("GET /api/auth/confirm", () => {
  it("exchanges an email token hash and redirects into the portal", async () => {
    mockVerifyOtp.mockResolvedValueOnce({ error: null });

    const response = await GET(
      request({
        token_hash: "hashed-token",
        type: "email",
        redirect_to: "https://brewery.example/portal/orders",
      }),
    );

    expect(mockVerifyOtp).toHaveBeenCalledWith({
      token_hash: "hashed-token",
      type: "email",
    });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://brewery.example/portal/orders",
    );
  });

  it("rejects an off-origin redirect after a successful exchange", async () => {
    mockVerifyOtp.mockResolvedValueOnce({ error: null });

    const response = await GET(
      request({
        token_hash: "hashed-token",
        type: "email",
        redirect_to: "https://evil.example/steal",
      }),
    );

    expect(response.headers.get("location")).toBe("https://brewery.example/");
  });

  it("does not exchange missing or unsupported token parameters", async () => {
    const response = await GET(
      request({ token_hash: "hashed-token", type: "recovery" }),
    );

    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://brewery.example/login?error=invalid_confirmation",
    );
  });

  it("redirects to login when Supabase rejects the token", async () => {
    mockVerifyOtp.mockResolvedValueOnce({
      error: { message: "Token has expired or is invalid" },
    });

    const response = await GET(
      request({
        token_hash: "expired-token",
        type: "email",
        redirect_to: "https://brewery.example/portal/orders",
      }),
    );

    expect(response.headers.get("location")).toBe(
      "https://brewery.example/portal/login?error=confirmation_failed",
    );
  });
});
