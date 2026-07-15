/**
 * Auth Layout
 *
 * Split-screen layout for login/forgot-password pages (signup was removed —
 * accounts are invite-only, audit C1/M16).
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
    // Do not bounce a disabled old session back into the protected layout;
    // that would create a redirect loop. Only enabled profiles leave login.
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("status")
      .eq("id", user.id)
      .single();
    if (profile?.status === "active") {
      redirect("/");
    }
  }

  return <AuthShell>{children}</AuthShell>;
}
