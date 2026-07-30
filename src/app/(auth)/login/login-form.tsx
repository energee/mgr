"use client";

/**
 * Login Form
 *
 * Handles email/password login and passwordless authentication.
 * Passwordless flow sends a magic link and OTP code via email.
 * Users can either click the link or enter the code manually.
 *
 * Invite-only: the passwordless flow passes `shouldCreateUser: false` —
 * staff accounts are provisioned via /api/users/invite, never self-registered
 * here (audit DL-2; implicit signup minted a 'viewer'-role staff profile).
 *
 * Validation errors are announced to screen readers: each error paragraph is
 * a `role="alert"` region referenced by the failing input's `aria-describedby`
 * with `aria-invalid` set (audit A11Y-4). Inputs carry autocomplete tokens
 * (audit A11Y-5).
 *
 * The "Dev Login" button's visibility comes from `devLoginAffordance()` in
 * `@/lib/dev-login` — the module `/api/auth/dev-login`'s gate classifies its
 * target with — and NOT from a local `process.env.NODE_ENV` test. It used to be
 * the latter, which silently desynchronized when #679 tightened the route: the
 * button rendered, the route refused, and the browser landed on raw
 * `{"error":"Not found"}` with the reason only in the server terminal. A
 * contract test in the route's suite drives the button state and the gate
 * across one matrix and fails if they diverge again.
 */

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { rememberEmail, readRememberedEmail, otpSignInErrorMessage } from "@/lib/auth-utils";
import { ALLOW_REMOTE_DB_VALUE, ALLOW_REMOTE_DB_VAR, devLoginAffordance } from "@/lib/dev-login";
import { useSubmitShortcut } from "@/hooks/use-submit-shortcut";
import { OtpCodeInput, OTP_LENGTH } from "@/components/auth/otp-code-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/";
  const supabase = createClient();
  const submitRef = useSubmitShortcut();
  const otpFormRef = useRef<HTMLFormElement>(null);
  /* Whether — and how — to offer the dev-login shortcut. Comes from the module
     the route's gate classifies its target with, never from a second local
     environment test (see this file's docstring). Not state: every input is a
     build-time constant in the client bundle, so it collapses to "hidden" in a
     production build and the whole block below is compiled out. */
  const devLogin = devLoginAffordance();

  const [isLoading, setIsLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [email, setEmail] = useState(() => readRememberedEmail());
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors({});

    // Validate
    const result = loginSchema.safeParse({ email, password });
    if (!result.success) {
      const fieldErrors: { email?: string; password?: string } = {};
      result.error.issues.forEach((err) => {
        if (err.path[0] === "email") fieldErrors.email = err.message;
        if (err.path[0] === "password") fieldErrors.password = err.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      rememberEmail(email);
      router.push(redirect);
      router.refresh();
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordless = async () => {
    if (!email || !z.string().email().safeParse(email).success) {
      toast.error("Please enter a valid email first");
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          // Invite-only: never create an auth user for an unknown email —
          // implicit signup gave any address a 'viewer'-role staff profile
          // via create_user_profile() (audit DL-2). Staff are provisioned
          // via /api/users/invite.
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}${redirect}`,
        },
      });

      if (error) {
        toast.error(otpSignInErrorMessage(error.message));
        return;
      }

      rememberEmail(email);
      setOtpSent(true);
      setOtpCode("");
      toast.success("Check your email for a login link or code");
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: FormEvent) => {
    e.preventDefault();
    if (!otpCode.trim()) return;

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: otpCode.trim(),
        type: "email",
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      rememberEmail(email);
      router.push(redirect);
      router.refresh();
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  if (otpSent) {
    return (
      <form ref={otpFormRef} onSubmit={handleVerifyOtp} className="space-y-6">
        <p className="text-sm text-muted-foreground text-center">
          We sent a login link and code to <span className="font-medium text-foreground">{email}</span>.
          Click the link or enter the code below.
        </p>
        <div className="flex flex-col items-center gap-2">
          <Label htmlFor="otp" className="sr-only">Verification code</Label>
          <OtpCodeInput
            id="otp"
            value={otpCode}
            onChange={setOtpCode}
            onComplete={() => otpFormRef.current?.requestSubmit()}
            disabled={isLoading}
          />
        </div>
        <Button ref={submitRef} type="submit" className="w-full" disabled={isLoading || otpCode.length < OTP_LENGTH}>
          {isLoading ? "Verifying..." : <><span>Verify</span><Kbd>&#8984;&#9166;</Kbd></>}
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={() => setOtpSent(false)} disabled={isLoading}>
            Back
          </Button>
          <Button type="button" variant="outline" className="flex-1" onClick={handlePasswordless} disabled={isLoading}>
            Resend code
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="you@brewery.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={isLoading}
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? "email-error" : undefined}
        />
        {errors.email && (
          <p id="email-error" role="alert" className="text-sm text-destructive">
            {errors.email}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link
            href="/forgot-password"
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            Forgot password?
          </Link>
        </div>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isLoading}
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? "password-error" : undefined}
        />
        {errors.password && (
          <p id="password-error" role="alert" className="text-sm text-destructive">
            {errors.password}
          </p>
        )}
      </div>

      <Button ref={submitRef} type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? "Signing in..." : <><span>Sign in</span><Kbd>&#8984;&#9166;</Kbd></>}
      </Button>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <Separator className="w-full" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">Or</span>
        </div>
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={handlePasswordless}
        disabled={isLoading}
      >
        Sign in with magic link
      </Button>

      {devLogin !== "hidden" && (
        <>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <Separator className="w-full" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">Dev</span>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={isLoading}
            onClick={() => {
              window.location.href = `/api/auth/dev-login?redirect=${encodeURIComponent(redirect)}`;
            }}
          >
            Dev Login (dev@brewery.test)
          </Button>
          {/* The server-only opt-in is unreadable from here (no NEXT_PUBLIC_
              prefix, deliberately), so state the precondition rather than guess:
              without it the click lands on a bare 404 whose reason is otherwise
              server-side only. */}
          {devLogin === "needs-opt-in" && (
            <p className="text-xs text-muted-foreground">
              This app&apos;s Supabase URL is not loopback, so dev login needs{" "}
              <code>
                {ALLOW_REMOTE_DB_VAR}={ALLOW_REMOTE_DB_VALUE}
              </code>{" "}
              on the server (issue #679). Without it the button returns 404.
            </p>
          )}
        </>
      )}

      {/* No self-serve signup: accounts are invite-only (audit C1/M16).
          Staff are invited from the users admin; customers via the portal
          invite flow. */}
    </form>
  );
}
