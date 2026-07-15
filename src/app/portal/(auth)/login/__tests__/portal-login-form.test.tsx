/**
 * Portal passwordless-login regression coverage.
 *
 * Magic-link emails now exchange token hashes through /api/auth/confirm, so
 * RedirectTo must be the final portal page rather than the legacy PKCE callback.
 */
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupRenderHarness } from "@/test/react-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mockSignInWithOtp = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInWithOtp: mockSignInWithOtp,
      verifyOtp: vi.fn(),
    },
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/components/auth/otp-code-input", () => ({
  OTP_LENGTH: 6,
  OtpCodeInput: ({ id }: { id?: string }) => <input id={id} />,
}));

import { PortalLoginForm } from "@/app/portal/(auth)/login/portal-login-form";

const { render } = setupRenderHarness();

beforeEach(() => {
  mockSignInWithOtp.mockReset();
});

describe("PortalLoginForm", () => {
  it("sends invite-only magic links to the final portal destination", async () => {
    mockSignInWithOtp.mockResolvedValueOnce({ error: null });
    const container = render(<PortalLoginForm />);
    const input = container.querySelector("#email") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;

    await act(async () => {
      setter.call(input, "buyer@example.com");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(mockSignInWithOtp).toHaveBeenCalledWith({
      email: "buyer@example.com",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "http://localhost:3000/portal/orders",
      },
    });
  });
});
