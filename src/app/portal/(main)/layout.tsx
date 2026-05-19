import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal/portal-shell";
import type { PortalCustomer } from "@/contexts/portal";
import { dynamicFrom } from "@/services/types";

export const metadata: Metadata = {
  title: "Customer Portal",
};

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/portal/login");
  }

  // Find linked customers via junction table
  const { data: links } = await dynamicFrom(supabase, "customer_portal_users")
    .select("customer_id, customers(id, name, email)")
    .eq("user_id", user.id);

  let customers: PortalCustomer[] = (links ?? [])
    .map((l: { customers: PortalCustomer | null }) => l.customers)
    .filter((c: PortalCustomer | null): c is PortalCustomer => c != null);

  // Auto-link by email on first login (no existing links)
  if (customers.length === 0 && user.email) {
    const adminDb = await createAdminClient();
    const { data: matched } = await dynamicFrom(adminDb, "customers")
      .select("id, name, email")
      .eq("email", user.email);

    if (matched?.length > 0) {
      for (const cust of matched) {
        await dynamicFrom(adminDb, "customer_portal_users")
          .upsert({ customer_id: cust.id, user_id: user.id });
      }
      customers = matched.map((c: PortalCustomer) => ({
        id: c.id,
        name: c.name,
      }));
    }
  }

  // Get brewery branding and contact info
  const { data: settings } = await dynamicFrom(supabase, "system_settings")
    .select("key, value")
    .in("key", ["brewery_name", "brewery_logo_svg", "brewery_email"]);

  const settingsMap = Object.fromEntries(
    (settings ?? []).map((row: { key: string; value: unknown }) => [row.key, row.value])
  );

  return (
    <PortalShell
      customers={customers}
      breweryName={(settingsMap.brewery_name as string) ?? null}
      breweryLogo={(settingsMap.brewery_logo_svg as string) ?? null}
      breweryEmail={(settingsMap.brewery_email as string) ?? null}
    >
      {children}
    </PortalShell>
  );
}
