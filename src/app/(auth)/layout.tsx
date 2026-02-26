/**
 * Auth Layout
 *
 * Centered layout for login/signup pages.
 * Redirects logged-in users to the app.
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Sign In",
};
import { redirect } from "next/navigation";

interface AuthLayoutProps {
  children: ReactNode;
}

export default async function AuthLayout({ children }: AuthLayoutProps) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    redirect("/");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
