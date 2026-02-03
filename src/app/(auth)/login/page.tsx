/**
 * Login Page
 *
 * Email/password authentication with magic link option.
 */

import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { MGRIcon } from "@/components/icons/mgr-logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  return (
    <Card>
      <CardHeader className="text-center">
        <div className="flex items-center justify-center gap-2">
          <MGRIcon size={28} />
          <CardTitle className="text-2xl">MGR</CardTitle>
        </div>
        <CardDescription>Sign in to your brewery account</CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense fallback={<div className="h-64 animate-pulse" />}>
          <LoginForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
