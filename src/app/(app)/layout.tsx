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

interface AppLayoutProps {
  children: ReactNode;
}

export default async function AppLayout({ children }: AppLayoutProps) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Get brewery settings (single-tenant)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: settings } = await db
    .from("settings")
    .select("brewery_name")
    .single();

  const breweryName = settings?.brewery_name || "My Brewery";

  return (
    <div className="flex min-h-screen">
      <AppSidebar />
      <div className="flex-1 flex flex-col">
        <AppHeader user={user} breweryName={breweryName} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
