/**
 * Update Password Page
 *
 * Final step of the password recovery flow. The user arrives here after
 * /api/auth/callback?type=recovery has exchanged the recovery code for a
 * session. Server-side guards: redirect unauthenticated users to /login.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { UpdatePasswordForm } from "./update-password-form";

export default async function UpdatePasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <>
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Set a new password</h1>
        <p className="text-sm text-muted-foreground">
          Choose a new password for your account
        </p>
      </div>
      <UpdatePasswordForm />
    </>
  );
}
