/**
 * Health Check Endpoint
 *
 * Returns the overall health of the application, including database connectivity.
 * - 200 with { status: "ok", database: "connected" } when everything is healthy
 * - 503 with { status: "degraded", database: "unreachable" } when the database is down
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("_schema_registry")
      .select("table_name")
      .limit(1);

    if (error) {
      return NextResponse.json(
        { status: "degraded", database: "unreachable" },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { status: "ok", database: "connected" },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      { status: "degraded", database: "unreachable" },
      { status: 503 }
    );
  }
}
