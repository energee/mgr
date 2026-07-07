"use client";

/**
 * Portal Login Form
 *
 * Simplified magic-link-only login for brewery customers.
 * Sends an OTP code via email, then verifies it to sign in.
 *
 * Invite-only: `shouldCreateUser: false` — the portal never self-registers
 * accounts (audit C1/M16). Portal users are provisioned exclusively via the
 * staff customer-invite flow (/api/customers/[id]/invite).
 */

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { OtpCodeInput, OTP_LENGTH } from "@/components/auth/otp-code-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const emailSchema = z.string().email("Please enter a valid email");

export function PortalLoginForm() {
  const router = useRouter();
  const supabase = createClient();
  const otpFormRef = useRef<HTMLFormElement>(null);

  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");

  async function sendOtp(): Promise<boolean> {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // Invite-only portal: never create an auth user for an unknown email
        // (self-registration granted the staff 'viewer' role — audit C1/M16).
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/api/auth/callback?redirect=/portal/orders`,
      },
    });
    if (error) {
      toast.error(error.message);
      return false;
    }
    return true;
  }

  async function handleSendOtp(e: FormEvent) {
    e.preventDefault();
    setEmailError(null);

    const result = emailSchema.safeParse(email);
    if (!result.success) {
      setEmailError(result.error.issues[0].message);
      return;
    }

    setIsLoading(true);
    try {
      if (await sendOtp()) {
        setOtpSent(true);
        setOtpCode("");
        toast.success("Check your email for a login link");
      }
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleResend() {
    setIsLoading(true);
    try {
      if (await sendOtp()) {
        toast.success("Login code resent");
      }
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleVerifyOtp(e: FormEvent) {
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

      router.push("/portal/orders");
      router.refresh();
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  }

  return otpSent ? (
    <form ref={otpFormRef} onSubmit={handleVerifyOtp} className="space-y-6">
      <p className="text-sm text-muted-foreground text-center">
        Enter the code we sent to{" "}
        <span className="font-medium text-foreground">{email}</span>
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
      <Button
        type="submit"
        className="w-full"
        disabled={isLoading || otpCode.length < OTP_LENGTH}
      >
        {isLoading ? "Verifying..." : "Verify"}
      </Button>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={() => {
            setOtpSent(false);
            setOtpCode("");
          }}
          disabled={isLoading}
        >
          Back
        </Button>
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={handleResend}
          disabled={isLoading}
        >
          Resend code
        </Button>
      </div>
    </form>
  ) : (
    <form onSubmit={handleSendOtp} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (emailError) setEmailError(null);
          }}
          disabled={isLoading}
        />
        {emailError && (
          <p className="text-sm text-destructive">{emailError}</p>
        )}
      </div>
      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? "Sending..." : "Send Login Link"}
      </Button>
    </form>
  );
}
