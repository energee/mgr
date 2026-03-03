/**
 * Signup Page
 *
 * New user registration.
 * Renders heading + subtitle + form inside the split-screen auth layout.
 */

import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <>
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Create an account
        </h1>
        <p className="text-sm text-muted-foreground">
          Enter your details to get started
        </p>
      </div>
      <SignupForm />
    </>
  );
}
