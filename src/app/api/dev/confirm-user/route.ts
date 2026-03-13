/**
 * DEV ONLY: Confirm user email
 *
 * This endpoint confirms a user's email for testing.
 * Only available in development mode.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { clientEnv, getServerEnv } from "@/lib/env";

export async function POST(request: NextRequest) {
  // Defense-in-depth: require both NODE_ENV=development AND explicit opt-in
  if (process.env.NODE_ENV !== "development" || process.env.ENABLE_DEV_ENDPOINTS !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { email } = await request.json();

  if (!email) {
    return NextResponse.json({ error: "Email required" }, { status: 400 });
  }

  // Use admin client to bypass RLS
  const { SUPABASE_SERVICE_ROLE_KEY } = getServerEnv();
  const supabase = createClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    // Get user by email
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();

    if (listError) {
      return NextResponse.json({ error: listError.message }, { status: 500 });
    }

    const user = users.find(u => u.email === email);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Update user to confirm email
    const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
      email_confirm: true,
    });

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `User ${email} confirmed`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
