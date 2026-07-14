/** Uploads and persists a dry-run Beer Orders spreadsheet reconciliation plan. */

export const runtime = "nodejs";
export const maxDuration = 60;

import { createHash } from "node:crypto";
import { withPermission } from "@/lib/api/auth";
import { errorResponse, successResponse } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/server";
import { unwrap } from "@/lib/supabase/query-helpers";
import { dynamicFrom } from "@/services/types";
import { parseBeerOrderWorkbook } from "@/integrations/beer-orders/parser";
import { buildBeerOrderImportPlan } from "@/integrations/beer-orders/planner";
import { loadBeerOrderReferenceData } from "@/integrations/beer-orders/reference-data";
import { beerOrderMappingOverridesSchema } from "@/integrations/beer-orders/validation";
import type { BeerOrderMappingOverrides } from "@/integrations/beer-orders/types";

const MAX_FILE_SIZE = 4 * 1024 * 1024;

export const POST = withPermission("integrations:manage", async (request, { user }) => {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return errorResponse("FILE_REQUIRED", "Choose a Beer Orders .xlsx file", undefined, 400);
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return errorResponse("INVALID_FILE_TYPE", "Beer Orders imports must be .xlsx files", undefined, 415);
  }
  if (file.size === 0 || file.size > MAX_FILE_SIZE) {
    return errorResponse("INVALID_FILE_SIZE", "The workbook must be between 1 byte and 4 MiB", undefined, 413);
  }

  let overrides: BeerOrderMappingOverrides = {};
  const rawOverrides = form.get("mappings");
  if (typeof rawOverrides === "string" && rawOverrides.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawOverrides);
    } catch {
      return errorResponse("INVALID_MAPPINGS", "Mapping selections are not valid JSON", undefined, 400);
    }
    const result = beerOrderMappingOverridesSchema.safeParse(parsed);
    if (!result.success) {
      return errorResponse("INVALID_MAPPINGS", "Mapping selections are invalid", result.error.flatten(), 400);
    }
    overrides = result.data;
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let parsedWorkbook;
  try {
    parsedWorkbook = await parseBeerOrderWorkbook(bytes);
  } catch (error) {
    return errorResponse(
      "INVALID_WORKBOOK",
      error instanceof Error ? error.message : "The workbook could not be parsed",
      undefined,
      422,
    );
  }

  try {
    const admin = await createAdminClient();
    const references = await loadBeerOrderReferenceData(admin);
    const plan = buildBeerOrderImportPlan(parsedWorkbook, references, overrides);
    const run = await unwrap<{ id: string }>(
      dynamicFrom(admin, "beer_order_import_runs")
        .insert({
          filename: file.name,
          file_sha256: sha256,
          status: "previewed",
          plan,
          summary: plan.summary,
          created_by: user.id,
        })
        .select("id")
        .single(),
    );
    return successResponse({ runId: run.id, filename: file.name, sha256, plan });
  } catch (error) {
    return errorResponse(
      "PREVIEW_FAILED",
      error instanceof Error ? error.message : "Unable to build the reconciliation preview",
      undefined,
      500,
    );
  }
});
