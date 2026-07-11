/**
 * LoginForm passwordless-flow tests (audit DL-2):
 * - `signInWithOtp` is called with `shouldCreateUser: false` so the staff
 *   magic-link flow can never self-register an auth user (implicit signup
 *   minted a 'viewer'-role staff profile via create_user_profile()).
 * - Supabase's raw "Signups not allowed for otp" rejection for unknown
 *   emails is mapped to a friendly "no account" message.
 * - Success still flips the form into the OTP-entry state.
 *
 * Uses the shared createRoot+act harness (src/test/react-harness.ts) — the
 * repo intentionally has no @testing-library/react.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { act } from "react";
import { setupRenderHarness } from "@/test/react-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// ---------------------------------------------------------------------------
// Mocks (before importing the form)
// ---------------------------------------------------------------------------

const mockSignInWithOtp = vi.fn();
const mockSignInWithPassword = vi.fn();
const mockVerifyOtp = vi.fn();

// Also prevents @/lib/env validation from throwing at import time.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInWithOtp: mockSignInWithOtp,
      signInWithPassword: mockSignInWithPassword,
      verifyOtp: mockVerifyOtp,
    },
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
}));

// The OTP input (input-otp) is irrelevant here; stub it to keep the
// post-send render cheap.
vi.mock("@/components/auth/otp-code-input", () => ({
  OTP_LENGTH: 6,
  OtpCodeInput: ({ id }: { id?: string }) => <input id={id} />,
}));

// vitest's jsdom env under Node 25 has no working localStorage (Node's
// experimental `localStorage` global shadows jsdom's as `undefined`), but
// auth-utils' remembered-email helpers run at render time — stub a minimal
// in-memory one.
const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, String(v)),
  removeItem: (k: string) => void storage.delete(k),
  clear: () => storage.clear(),
});

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { LoginForm } from "@/app/(auth)/login/login-form";
import { otpSignInErrorMessage } from "@/lib/auth-utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const { render } = setupRenderHarness();

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(text)
  );
  expect(button, `button "${text}" not found`).toBeDefined();
  return button as HTMLButtonElement;
}

async function typeEmail(container: HTMLElement, email: string) {
  const input = container.querySelector("#email") as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )!.set!;
  await act(async () => {
    setter.call(input, email);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function requestMagicLink(email: string): Promise<HTMLElement> {
  const container = render(<LoginForm />);
  await typeEmail(container, email);
  const button = findButton(container, "Sign in with magic link");
  await act(async () => {
    button.click();
  });
  return container;
}

beforeEach(() => {
  mockSignInWithOtp.mockReset();
  mockToastError.mockReset();
  mockToastSuccess.mockReset();
  storage.clear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LoginForm passwordless flow", () => {
  it("never self-registers: passes shouldCreateUser: false to signInWithOtp", async () => {
    mockSignInWithOtp.mockResolvedValueOnce({ error: null });

    await requestMagicLink("staff@brewery.com");

    expect(mockSignInWithOtp).toHaveBeenCalledTimes(1);
    expect(mockSignInWithOtp).toHaveBeenCalledWith({
      email: "staff@brewery.com",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: expect.stringContaining("/api/auth/callback"),
      },
    });
  });

  it("maps the unknown-email rejection to a friendly 'no account' message", async () => {
    mockSignInWithOtp.mockResolvedValueOnce({
      error: { message: "Signups not allowed for otp" },
    });

    const container = await requestMagicLink("intruder@example.com");

    expect(mockToastError).toHaveBeenCalledWith(
      "No account found for this email — contact an administrator."
    );
    // Stays on the credentials form — no OTP-sent state for unknown emails.
    expect(container.querySelector("#password")).not.toBeNull();
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it("surfaces other signInWithOtp errors unchanged", async () => {
    mockSignInWithOtp.mockResolvedValueOnce({
      error: { message: "Email rate limit exceeded" },
    });

    await requestMagicLink("staff@brewery.com");

    expect(mockToastError).toHaveBeenCalledWith("Email rate limit exceeded");
  });

  it("flips to the OTP-entry state on success", async () => {
    mockSignInWithOtp.mockResolvedValueOnce({ error: null });

    const container = await requestMagicLink("staff@brewery.com");

    expect(mockToastSuccess).toHaveBeenCalled();
    expect(container.textContent).toContain("We sent a login link and code");
  });
});

describe("otpSignInErrorMessage (shared with portal login)", () => {
  it("maps any 'signups not allowed' variant, case-insensitively", () => {
    expect(otpSignInErrorMessage("Signups not allowed for otp")).toBe(
      "No account found for this email — contact an administrator."
    );
    expect(otpSignInErrorMessage("signups not allowed for this instance")).toBe(
      "No account found for this email — contact an administrator."
    );
  });

  it("passes other messages through unchanged", () => {
    expect(otpSignInErrorMessage("Email rate limit exceeded")).toBe(
      "Email rate limit exceeded"
    );
  });
});
