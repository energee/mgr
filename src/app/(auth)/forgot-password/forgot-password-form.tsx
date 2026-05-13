"use client";

/**
 * Forgot Password Form
 *
 * Calls supabase.auth.resetPasswordForEmail with a redirect to the auth
 * callback tagged with type=recovery, which then forwards to /update-password.
 */

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { useSubmitShortcut } from "@/hooks/use-submit-shortcut";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const forgotSchema = z.object({
  email: z.string().email("Please enter a valid email"),
});

export function ForgotPasswordForm() {
  const supabase = createClient();
  const submitRef = useSubmitShortcut();

  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("mgr:login-email") ?? "";
    }
    return "";
  });
  const [error, setError] = useState<string | undefined>();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);

    const result = forgotSchema.safeParse({ email });
    if (!result.success) {
      setError(result.error.issues[0]?.message);
      return;
    }

    setIsLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/api/auth/callback?type=recovery`,
      });

      if (resetError) {
        toast.error(resetError.message);
        return;
      }

      localStorage.setItem("mgr:login-email", email);
      setSent(true);
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground text-center">
          If an account exists for <span className="font-medium text-foreground">{email}</span>,
          we&apos;ve sent a link to reset your password.
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
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
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <Button ref={submitRef} type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? "Sending..." : <><span>Send reset link</span><Kbd>&#8984;&#9166;</Kbd></>}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link href="/login" className="underline hover:text-foreground">
          Sign in
        </Link>
      </p>
    </form>
  );
}
