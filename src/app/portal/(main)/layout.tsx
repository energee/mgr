import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal/portal-shell";
import type { PortalCustomer } from "@/lib/portal-context";

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: links } = await db
    .from("customer_portal_users")
    .select("customer_id, customers(id, name, email)")
    .eq("user_id", user.id);

  let customers: PortalCustomer[] = (links ?? [])
    .map((l: { customers: PortalCustomer | null }) => l.customers)
    .filter((c: PortalCustomer | null): c is PortalCustomer => c != null);

  // Auto-link by email on first login (no existing links)
  if (customers.length === 0 && user.email) {
    const adminDb = await createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminAny = adminDb as any;
    const { data: matched } = await adminAny
      .from("customers")
      .select("id, name, email")
      .eq("email", user.email);

    if (matched?.length > 0) {
      for (const cust of matched) {
        await adminAny
          .from("customer_portal_users")
          .upsert({ customer_id: cust.id, user_id: user.id });
      }
      customers = matched.map((c: PortalCustomer) => ({
        id: c.id,
        name: c.name,
      }));
    }
  }

  if (customers.length === 0) {
    return <PortalShell customers={[]}>{children}</PortalShell>;
  }

  // Get brewery branding
  const { data: settings } = await db
    .from("system_settings")
    .select("key, value")
    .in("key", ["brewery_name", "brewery_logo_svg"]);

  const settingsMap = Object.fromEntries(
    (settings ?? []).map((row: { key: string; value: unknown }) => [row.key, row.value])
  );

  return (
    <PortalShell
      customers={customers}
      breweryName={(settingsMap.brewery_name as string) ?? null}
      breweryLogo={(settingsMap.brewery_logo_svg as string) ?? null}
    >
      {children}
    </PortalShell>
  );
}
