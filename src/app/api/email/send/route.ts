/**
 * POST /api/email/send
 *
 * Authenticated endpoint for sending templated notification emails.
 * Accepts a template name and data payload, renders the appropriate
 * HTML template, and sends via Resend.
 *
 * Rate limited to 5 emails per minute per user to prevent abuse.
 */

import { z } from "zod";
import {
  withAuth,
  validateBody,
  successResponse,
  errorResponse,
  rateLimit,
} from "@/lib/api";
import { sendNotificationEmail } from "@/lib/email";
import {
  lowInventoryAlert,
  orderStatusChange,
  batchStateTransition,
  type EmailTemplate,
} from "@/lib/email-templates";

// -- Validation schemas -------------------------------------------------------

const TEMPLATE_NAMES = [
  "low_inventory_alert",
  "order_status_change",
  "batch_state_transition",
] as const;

const sendEmailSchema = z.object({
  to: z.union([z.string().email(), z.array(z.string().email()).min(1)]),
  template: z.enum(TEMPLATE_NAMES),
  data: z.record(z.string(), z.unknown()),
});

type SendEmailBody = z.infer<typeof sendEmailSchema>;

// -- Template rendering -------------------------------------------------------

/**
 * Render a named template with the provided data payload.
 * Throws if required data fields are missing.
 */
function renderTemplate(
  template: SendEmailBody["template"],
  data: Record<string, unknown>,
): EmailTemplate {
  switch (template) {
    case "low_inventory_alert":
      return lowInventoryAlert(
        String(data.itemName ?? ""),
        Number(data.currentQty ?? 0),
        Number(data.reorderPoint ?? 0),
      );
    case "order_status_change":
      return orderStatusChange(
        String(data.orderNumber ?? ""),
        String(data.oldStatus ?? ""),
        String(data.newStatus ?? ""),
        String(data.customerName ?? ""),
      );
    case "batch_state_transition":
      return batchStateTransition(
        String(data.batchName ?? ""),
        String(data.oldState ?? ""),
        String(data.newState ?? ""),
      );
  }
}

// -- Route handler ------------------------------------------------------------

export const POST = withAuth(async (request, { user }) => {
  // Rate limit: 5 emails per minute per user
  const rl = rateLimit(`email:${user.id}`, {
    windowMs: 60_000,
    maxRequests: 5,
  });

  if (!rl.success) {
    return errorResponse(
      "RATE_LIMITED",
      "Too many email requests. Please try again later.",
      { retryAfterMs: rl.resetMs },
      429,
    );
  }

  const body = await validateBody(sendEmailSchema, request);
  const rendered = renderTemplate(body.template, body.data);

  const result = await sendNotificationEmail(
    body.to,
    rendered.subject,
    rendered.html,
  );

  if (!result.ok && !result.skipped) {
    return errorResponse(
      "INTERNAL_ERROR",
      "Failed to send email",
      { error: result.error },
      500,
    );
  }

  return successResponse({
    sent: !result.skipped,
    id: result.id ?? null,
    skipped: result.skipped ?? false,
  });
});
