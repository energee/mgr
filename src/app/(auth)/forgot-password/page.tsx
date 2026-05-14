/**
 * Forgot Password Page
 *
 * Collects an email and sends a Supabase password-recovery link.
 * The link lands on /api/auth/callback?type=recovery which exchanges
 * the code for a session and forwards the user to /update-password.
 */

import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <>
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="text-sm text-muted-foreground">
          We&apos;ll email you a link to set a new password
        </p>
      </div>
      <ForgotPasswordForm />
    </>
  );
}
