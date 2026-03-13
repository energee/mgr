/**
 * Dev-Only Test Login Route
 *
 * Creates a test user (if needed) and signs them in automatically.
 * Only available in development mode — returns 404 in production.
 *
 * Usage: GET /api/auth/dev-login
 * Optional query param: ?redirect=/some-page
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isValidRedirect } from "@/lib/auth-utils";

const TEST_EMAIL = "dev@brewery.test";
const TEST_PASSWORD = "devpassword123";

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const redirect = request.nextUrl.searchParams.get("redirect") || "/";
  const admin = await createAdminClient();

  // Ensure test user exists (idempotent)
  const { data: existingUsers } = await admin.auth.admin.listUsers();
  let testUser = existingUsers?.users?.find((u) => u.email === TEST_EMAIL);

  if (!testUser) {
    const { data: createData, error: createError } = await admin.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Dev User" },
    });
    if (createError) {
      return NextResponse.json(
        { error: "Failed to create test user", detail: createError.message },
        { status: 500 },
      );
    }
    testUser = createData.user;
  }

  // Ensure user_profiles has admin role (idempotent — runs every login)
  if (testUser) {
    const { error: upsertError } = await admin.from("user_profiles").upsert(
      {
        id: testUser.id,
        email: TEST_EMAIL,
        display_name: "Dev User",
        roles: ["admin"],
        status: "active",
      },
      { onConflict: "id" },
    );
    if (upsertError) {
      return NextResponse.json(
        { error: "Failed to upsert user profile", detail: upsertError.message },
        { status: 500 },
      );
    }
  }

  // Sign in via the regular server client (sets session cookies)
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });

  if (signInError) {
    return NextResponse.json(
      { error: "Failed to sign in", detail: signInError.message },
      { status: 500 },
    );
  }

  const safeRedirect = isValidRedirect(redirect) ? redirect : "/";

  return NextResponse.redirect(new URL(safeRedirect, request.nextUrl.origin));
}
