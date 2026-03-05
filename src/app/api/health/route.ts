/**
 * Health Check Endpoint
 *
 * Returns the overall health of the application, including database connectivity.
 * - 200 with { status: "ok", database: "connected" } when everything is healthy
 * - 503 with { status: "degraded", database: "unreachable" } when the database is down
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

const log = logger.child({ route: "/api/health" });

export async function GET() {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("_schema_registry")
      .select("table_name")
      .limit(1);

    if (error) {
      log.warn({ error: error.message }, "Health check degraded: database unreachable");
      return NextResponse.json(
        { status: "degraded", database: "unreachable" },
        { status: 503 }
      );
    }

    log.debug("Health check passed");
    return NextResponse.json(
      { status: "ok", database: "connected" },
      { status: 200 }
    );
  } catch (err) {
    log.error({ error: err instanceof Error ? err.message : String(err) }, "Health check failed with exception");
    return NextResponse.json(
      { status: "degraded", database: "unreachable" },
      { status: 503 }
    );
  }
}
