/**
 * POST /api/users/:id/status
 *
 * Runs the dedicated deactivate/reactivate command. It is intentionally not
 * generic profile CRUD: ordering the database gate with the Auth ban/unban is
 * required for safe revocation and compensation.
 */

import { z } from "zod";
import { successResponse } from "@/lib/api/response";
import { withPermission } from "@/lib/api/auth";
import { validateBody } from "@/lib/api/validation";
import { ApiError } from "@/lib/api/errors";
import { createAdminClient } from "@/lib/supabase/server";
import { changeUserAccountStatus } from "@/services/user-account-status";

const commandSchema = z.object({
  command: z.enum(["deactivate", "reactivate"]),
});

export const POST = withPermission(
  "users:manage",
  async (request, { params, user }) => {
    const userId = params?.id;
    if (!userId) {
      throw new ApiError("VALIDATION_ERROR", "User ID required");
    }

    const { command } = await validateBody(commandSchema, request);
    if (command === "deactivate" && userId === user.id) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "You cannot deactivate your own account",
        422,
      );
    }

    const adminDb = await createAdminClient();
    const result = await changeUserAccountStatus(adminDb, userId, command);

    if (!result.ok) {
      const isConflict = result.code === "COMMAND_IN_PROGRESS";
      throw new ApiError(
        result.code === "NOT_FOUND"
          ? "NOT_FOUND"
          : isConflict
            ? "CONFLICT"
            : "INTERNAL_ERROR",
        result.message,
        result.code === "NOT_FOUND" ? 404 : isConflict ? 409 : 500,
        result,
      );
    }

    return successResponse(result);
  },
);
