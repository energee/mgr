"use client";

/**
 * Login Form
 *
 * Handles email/password login and magic link authentication.
 * Uses basic form handling for simplicity.
 */

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { useSubmitShortcut } from "@/hooks/use-submit-shortcut";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/";
  const supabase = createClient();
  const submitRef = useSubmitShortcut();

  const [isLoading, setIsLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [email, setEmail] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("mgr:login-email") ?? "";
    }
    return "";
  });
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

      localStorage.setItem("mgr:login-email", email);
      router.push(redirect);
      router.refresh();
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handleMagicLink = async () => {
    if (!email || !z.string().email().safeParse(email).success) {
      toast.error("Please enter a valid email first");
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/api/auth/callback?redirect=${redirect}`,
        },
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      localStorage.setItem("mgr:login-email", email);
      setOtpSent(true);
      setOtpCode("");
      toast.success("Check your email for the login code");
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

      localStorage.setItem("mgr:login-email", email);
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
      <form onSubmit={handleVerifyOtp} className="space-y-4">
        <p className="text-sm text-muted-foreground text-center">
          Enter the code we sent to <span className="font-medium text-foreground">{email}</span>
        </p>
        <div className="space-y-2">
          <Label htmlFor="otp">Code</Label>
          <Input
            id="otp"
            type="text"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            placeholder="Enter code"
            value={otpCode}
            onChange={(e) => setOtpCode(e.target.value)}
            disabled={isLoading}
          />
        </div>
        <Button ref={submitRef} type="submit" className="w-full" disabled={isLoading || !otpCode.trim()}>
          {isLoading ? "Verifying..." : <><span>Verify</span><Kbd>&#8984;&#9166;</Kbd></>}
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={() => setOtpSent(false)} disabled={isLoading}>
            Back
          </Button>
          <Button type="button" variant="outline" className="flex-1" onClick={handleMagicLink} disabled={isLoading}>
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
          placeholder="you@brewery.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={isLoading}
        />
        {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isLoading}
        />
        {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
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
        onClick={handleMagicLink}
        disabled={isLoading}
      >
        Sign in with email code
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <a href="/signup" className="underline hover:text-foreground">
          Sign up
        </a>
      </p>
    </form>
  );
}
