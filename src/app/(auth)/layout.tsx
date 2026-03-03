/**
 * Auth Layout
 *
 * Split-screen layout for login/signup pages.
 * Left panel: MGR branding. Right panel: auth form.
 * On mobile, left panel is hidden.
 * Redirects logged-in users to the app.
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MGRIcon } from "@/components/icons/mgr-logo";

export const metadata: Metadata = {
  title: "Sign In",
};

interface AuthLayoutProps {
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

  return (
    <div className="relative min-h-screen items-center justify-center md:grid lg:max-w-none lg:grid-cols-2 lg:px-0">
      <div className="relative hidden h-full flex-col p-10 text-primary lg:flex dark:border-r">
        <div className="absolute inset-0 bg-primary/5" />
        <div className="relative z-20 flex items-center text-lg font-medium">
          <MGRIcon size={24} className="mr-2" />
          MGR
        </div>
        <div className="relative z-20 mt-auto">
          <blockquote className="text-balance leading-normal">
            Brewery management, simplified.
          </blockquote>
        </div>
      </div>
      <div className="flex min-h-screen items-center justify-center p-4 lg:p-8">
        <div className="mx-auto flex w-full max-w-[350px] flex-col justify-center gap-6">
          {children}
        </div>
      </div>
    </div>
  );
}
