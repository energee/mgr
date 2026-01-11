/**
 * Login Page
 *
 * Email/password authentication with magic link option.
 */

import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">MGR</CardTitle>
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
