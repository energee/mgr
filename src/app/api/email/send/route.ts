/**
 * POST /api/email/send
 *
 * Admin-only endpoint for sending templated notification emails.
 * Accepts a template name and data payload, renders the appropriate
 * HTML template, and sends via Resend.
 *
 * Restricted to users with `integrations:manage` permission (admin role)
 * to prevent abuse as an open relay. Rate limited to 5 emails per minute.
 */

import { z } from "zod";
import {
  withPermission,
  validateBody,
  successResponse,
  errorResponse,
  rateLimit,
} from "@/lib/api";
import { sendNotificationEmail } from "@/lib/email";
import {
  lowInventoryAlertTemplate,
  orderStatusChangeTemplate,
  batchStatusChangeTemplate,
  type EmailTemplate,
  type LowInventoryData,
  type OrderStatusChangeData,
  type BatchStatusChangeData,
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

const APP_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  "http://localhost:3000";

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
      return lowInventoryAlertTemplate(
        {
          itemName: String(data.itemName ?? ""),
          sku: data.sku ? String(data.sku) : null,
          quantityOnHand: Number(data.currentQty ?? 0),
          reorderPoint: Number(data.reorderPoint ?? 0),
          category: data.category ? String(data.category) : null,
        } satisfies LowInventoryData,
        APP_URL,
      );
    case "order_status_change":
      return orderStatusChangeTemplate(
        {
          orderNumber: String(data.orderNumber ?? ""),
          customerName: data.customerName ? String(data.customerName) : null,
          oldStatus: String(data.oldStatus ?? ""),
          newStatus: String(data.newStatus ?? ""),
        } satisfies OrderStatusChangeData,
        APP_URL,
      );
    case "batch_state_transition":
      return batchStatusChangeTemplate(
        {
          batchNumber: String(data.batchNumber ?? ""),
          batchName: data.batchName ? String(data.batchName) : null,
          oldStatus: String(data.oldStatus ?? ""),
          newStatus: String(data.newStatus ?? ""),
        } satisfies BatchStatusChangeData,
        APP_URL,
      );
  }
}

// -- Route handler ------------------------------------------------------------

export const POST = withPermission("integrations:manage", async (request, { user }) => {
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
    rendered.text,
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
