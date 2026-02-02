/**
 * Run Migration Script
 *
 * Run with: npx dotenv-cli -e .env -- npx tsx scripts/migrate.ts
 */

import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

async function migrate() {
  const projectId = process.env.SUPABASE_PROJECT_ID;

  if (!projectId) {
    console.error("SUPABASE_PROJECT_ID not set in .env");
    process.exit(1);
  }

  console.log("Running migration: 00002_single_tenant.sql\n");
  console.log(`Project ID: ${projectId}\n`);

  const migrationPath = join(process.cwd(), "supabase/migrations/00002_single_tenant.sql");
  readFileSync(migrationPath, "utf-8");

  try {
    // Use supabase CLI to run the migration
    execSync(
      `npx supabase db execute --project-ref ${projectId} -f "${migrationPath}"`,
      { stdio: "inherit" }
    );
    console.log("\n✓ Migration complete!");
  } catch {
    console.error("\nFailed to run migration via CLI.");
    console.log("\nPlease run manually in Supabase SQL Editor:");
    console.log("1. Go to https://supabase.com/dashboard/project/" + projectId + "/sql");
    console.log("2. Paste the migration SQL and run it");
    process.exit(1);
  }
}

migrate().catch(console.error);
