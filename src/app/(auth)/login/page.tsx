/**
 * Login Page
 *
 * Email/password authentication with passwordless (magic link + OTP code) option.
 * Renders heading + subtitle + form inside the split-screen auth layout.
 */

import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <>
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Enter your credentials to access your brewery
        </p>
      </div>
      <Suspense fallback={<div className="h-64 animate-pulse" />}>
        <LoginForm />
      </Suspense>
    </>
  );
}
