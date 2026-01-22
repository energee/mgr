/**
 * App Layout
 *
 * Main authenticated layout with sidebar navigation.
 * All protected routes render within this layout.
 */

import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/domain/app-sidebar";
import { AppHeader } from "@/components/domain/app-header";
import { AppProviders } from "@/components/domain/app-providers";

interface AppLayoutProps {
  children: ReactNode;
}

export default async function AppLayout({ children }: AppLayoutProps) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Get brewery name from system_settings
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: setting } = await db
    .from("system_settings")
    .select("value")
    .eq("key", "brewery_name")
    .single();

  const breweryName = (setting?.value as string) || "My Brewery";

  return (
    <AppProviders>
      <div className="flex min-h-screen">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <AppHeader user={user} breweryName={breweryName} />
          <main className="flex-1 p-6">{children}</main>
        </div>
      </div>
    </AppProviders>
  );
}
