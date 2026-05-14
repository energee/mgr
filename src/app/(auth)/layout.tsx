/**
 * Auth Layout
 *
 * Split-screen layout for login/signup/forgot-password pages.
 * Redirects logged-in users to the app (recovery flow uses /update-password
 * outside this group so the recovery session isn't bounced away).
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthShell } from "@/components/auth/auth-shell";

export const metadata: Metadata = {
  title: "Sign In",
};

type AuthLayoutProps = {
  children: ReactNode;
}

export default async function AuthLayout({ children }: AuthLayoutProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/");
  }

  return <AuthShell>{children}</AuthShell>;
}
