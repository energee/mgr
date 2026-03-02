/**
 * Email notification templates
 *
 * Template functions for transactional emails sent via the send-email Edge Function.
 * Each function returns { subject, html, text } for a specific notification type.
 *
 * Templates use inline CSS for maximum email client compatibility.
 * All templates include an unsubscribe link footer pointing to /settings/notifications.
 *
 * Status labels use formatStateLabel() from entity types (DEC-007 compliance)
 * rather than hardcoded maps, so new states are automatically handled.
 */

import { formatStateLabel } from "@/types/entity";

// =============================================================================
// Types
// =============================================================================

/** Output of every template function */
export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

/** Notification metadata passed from database triggers */
export interface NotificationContext {
  title: string;
  message: string | null;
  priority: string;
  actionUrl: string | null;
  type: string;
  metadata: Record<string, unknown>;
}

// =============================================================================
// Shared layout helpers
// =============================================================================

/**
 * Escape HTML special characters to prevent XSS in email templates.
 * All user-supplied strings must be passed through this before interpolation.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const BRAND_COLOR = "#2563eb";
const MUTED_COLOR = "#6b7280";
const BORDER_COLOR = "#e5e7eb";
const BG_COLOR = "#f9fafb";

/**
 * Wraps HTML body content in a responsive email layout with header and footer.
 * Uses inline CSS for email client compatibility.
 */
function wrapInLayout(bodyHtml: string, appUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MGR Brewery Notification</title>
</head>
<body style="margin:0;padding:0;background-color:${BG_COLOR};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:${BG_COLOR};">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;border:1px solid ${BORDER_COLOR};overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="padding:24px 32px;background-color:${BRAND_COLOR};color:#ffffff;">
              <strong style="font-size:18px;letter-spacing:0.5px;">MGR Brewery</strong>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              ${bodyHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px;border-top:1px solid ${BORDER_COLOR};color:${MUTED_COLOR};font-size:12px;line-height:1.5;">
              <p style="margin:0 0 8px 0;">
                You received this email because email notifications are enabled in your MGR account.
              </p>
              <p style="margin:0;">
                <a href="${appUrl}/settings/notifications" style="color:${BRAND_COLOR};text-decoration:underline;">
                  Manage notification preferences
                </a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Creates a call-to-action button for email templates.
 */
function ctaButton(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px 0;">
  <tr>
    <td style="background-color:${BRAND_COLOR};border-radius:6px;padding:12px 24px;">
      <a href="${url}" style="color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;">
        ${esc(label)}
      </a>
    </td>
  </tr>
</table>`;
}

/**
 * Renders a priority indicator badge for high/urgent notifications.
 */
function priorityBadge(priority: string): string {
  const baseStyle = "display:inline-block;padding:2px 8px;border-radius:4px;color:#ffffff;font-size:11px;font-weight:600;text-transform:uppercase;margin-left:8px;";

  switch (priority) {
    case "urgent":
      return `<span style="${baseStyle}background-color:#dc2626;">Urgent</span>`;
    case "high":
      return `<span style="${baseStyle}background-color:#f59e0b;">High Priority</span>`;
    default:
      return "";
  }
}

// =============================================================================
// Template: Low Inventory Alert
// =============================================================================

export interface LowInventoryData {
  itemName: string;
  sku: string | null;
  quantityOnHand: number;
  reorderPoint: number;
  category: string | null;
}

/**
 * Email template for low inventory alerts.
 * Sent when an inventory item falls below its reorder point.
 */
export function lowInventoryAlertTemplate(
  data: LowInventoryData,
  appUrl: string,
): EmailTemplate {
  const { itemName, sku, quantityOnHand, reorderPoint, category } = data;
  const skuDisplay = sku ? ` (${sku})` : "";
  const categoryDisplay = category ? ` in ${category}` : "";

  const subject = `Low Inventory Alert: ${itemName}`;

  const bodyHtml = `
    <h2 style="margin:0 0 16px 0;font-size:20px;color:#111827;">
      Low Inventory Alert${priorityBadge("high")}
    </h2>
    <p style="margin:0 0 16px 0;color:#374151;font-size:15px;line-height:1.6;">
      <strong>${esc(itemName)}</strong>${esc(skuDisplay)}${esc(categoryDisplay)} has dropped below its reorder point.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;width:100%;">
      <tr>
        <td style="padding:12px 16px;background-color:${BG_COLOR};border-radius:6px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td style="padding:4px 0;color:${MUTED_COLOR};font-size:13px;">Current Quantity</td>
              <td style="padding:4px 0;text-align:right;font-weight:600;color:#dc2626;font-size:15px;">${quantityOnHand}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:${MUTED_COLOR};font-size:13px;">Reorder Point</td>
              <td style="padding:4px 0;text-align:right;font-weight:600;color:#374151;font-size:15px;">${reorderPoint}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    ${ctaButton("View Item", `${appUrl}/inventory/items`)}
  `;

  const text = `Low Inventory Alert

${itemName}${skuDisplay}${categoryDisplay} has dropped below its reorder point.

Current Quantity: ${quantityOnHand}
Reorder Point: ${reorderPoint}

View in MGR: ${appUrl}/inventory/items

---
Manage notification preferences: ${appUrl}/settings/notifications`;

  return { subject, html: wrapInLayout(bodyHtml, appUrl), text };
}

// =============================================================================
// Template: Order Status Change
// =============================================================================

export interface OrderStatusChangeData {
  orderNumber: string;
  customerName: string | null;
  oldStatus: string;
  newStatus: string;
}


/**
 * Email template for order status changes.
 * Sent when an order transitions to a notable state (confirmed, ready, shipped, cancelled).
 */
export function orderStatusChangeTemplate(
  data: OrderStatusChangeData,
  appUrl: string,
): EmailTemplate {
  const { orderNumber, customerName, oldStatus, newStatus } = data;
  const customerDisplay = customerName ? ` from ${customerName}` : "";
  const isCancelled = newStatus === "cancelled";
  const priority = isCancelled || newStatus === "ready_to_ship" ? "high" : "normal";

  const subject = `Order ${orderNumber}: ${formatStateLabel(newStatus)}`;

  const bodyHtml = `
    <h2 style="margin:0 0 16px 0;font-size:20px;color:#111827;">
      Order Status Update${priorityBadge(priority)}
    </h2>
    <p style="margin:0 0 16px 0;color:#374151;font-size:15px;line-height:1.6;">
      Order <strong>${esc(orderNumber)}</strong>${esc(customerDisplay)} has been updated.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;width:100%;">
      <tr>
        <td style="padding:12px 16px;background-color:${BG_COLOR};border-radius:6px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td style="padding:4px 0;color:${MUTED_COLOR};font-size:13px;">Previous Status</td>
              <td style="padding:4px 0;text-align:right;color:#374151;font-size:14px;">${esc(formatStateLabel(oldStatus))}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:${MUTED_COLOR};font-size:13px;">New Status</td>
              <td style="padding:4px 0;text-align:right;font-weight:600;color:${isCancelled ? "#dc2626" : BRAND_COLOR};font-size:14px;">${esc(formatStateLabel(newStatus))}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    ${ctaButton("View Order", `${appUrl}/sales/orders`)}
  `;

  const text = `Order Status Update

Order ${orderNumber}${customerDisplay} has been updated.

Previous Status: ${formatStateLabel(oldStatus)}
New Status: ${formatStateLabel(newStatus)}

View in MGR: ${appUrl}/sales/orders

---
Manage notification preferences: ${appUrl}/settings/notifications`;

  return { subject, html: wrapInLayout(bodyHtml, appUrl), text };
}

// =============================================================================
// Template: Batch Status Change
// =============================================================================

export interface BatchStatusChangeData {
  batchNumber: string;
  batchName: string | null;
  oldStatus: string;
  newStatus: string;
}


/**
 * Email template for batch status changes.
 * Sent when a batch transitions to a notable state (fermenting, conditioning,
 * packaging, completed, cancelled).
 */
export function batchStatusChangeTemplate(
  data: BatchStatusChangeData,
  appUrl: string,
): EmailTemplate {
  const { batchNumber, batchName, oldStatus, newStatus } = data;
  const nameDisplay = batchName ? ` (${batchName})` : "";
  const isCancelled = newStatus === "cancelled";
  const priority =
    isCancelled || newStatus === "packaging" ? "high" : "normal";

  const subject = `Batch ${batchNumber}: ${formatStateLabel(newStatus)}`;

  const bodyHtml = `
    <h2 style="margin:0 0 16px 0;font-size:20px;color:#111827;">
      Batch Status Update${priorityBadge(priority)}
    </h2>
    <p style="margin:0 0 16px 0;color:#374151;font-size:15px;line-height:1.6;">
      Batch <strong>${esc(batchNumber)}</strong>${esc(nameDisplay)} has been updated.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;width:100%;">
      <tr>
        <td style="padding:12px 16px;background-color:${BG_COLOR};border-radius:6px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td style="padding:4px 0;color:${MUTED_COLOR};font-size:13px;">Previous Status</td>
              <td style="padding:4px 0;text-align:right;color:#374151;font-size:14px;">${esc(formatStateLabel(oldStatus))}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:${MUTED_COLOR};font-size:13px;">New Status</td>
              <td style="padding:4px 0;text-align:right;font-weight:600;color:${isCancelled ? "#dc2626" : BRAND_COLOR};font-size:14px;">${esc(formatStateLabel(newStatus))}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    ${ctaButton("View Batch", `${appUrl}/production/batches`)}
  `;

  const text = `Batch Status Update

Batch ${batchNumber}${nameDisplay} has been updated.

Previous Status: ${formatStateLabel(oldStatus)}
New Status: ${formatStateLabel(newStatus)}

View in MGR: ${appUrl}/production/batches

---
Manage notification preferences: ${appUrl}/settings/notifications`;

  return { subject, html: wrapInLayout(bodyHtml, appUrl), text };
}

// =============================================================================
// Template: Generic Notification (catch-all)
// =============================================================================

/**
 * Generic email template for notification types without a dedicated template.
 * Renders the notification title and message directly.
 */
export function genericNotificationTemplate(
  context: NotificationContext,
  appUrl: string,
): EmailTemplate {
  const { title, message, priority, actionUrl } = context;

  const subject = title;

  const messageHtml = message
    ? `<p style="margin:0 0 16px 0;color:#374151;font-size:15px;line-height:1.6;">${esc(message)}</p>`
    : "";

  const actionButton = actionUrl
    ? ctaButton("View Details", `${appUrl}${actionUrl}`)
    : "";

  const bodyHtml = `
    <h2 style="margin:0 0 16px 0;font-size:20px;color:#111827;">
      ${esc(title)}${priorityBadge(priority)}
    </h2>
    ${messageHtml}
    ${actionButton}
  `;

  const text = `${title}

${message ?? ""}

${actionUrl ? `View in MGR: ${appUrl}${actionUrl}` : ""}

---
Manage notification preferences: ${appUrl}/settings/notifications`;

  return { subject, html: wrapInLayout(bodyHtml, appUrl), text };
}

// =============================================================================
// Template router
// =============================================================================

/**
 * Selects the appropriate email template based on notification type and metadata.
 * Falls back to genericNotificationTemplate for unknown types.
 */
export function buildEmailFromNotification(
  context: NotificationContext,
  appUrl: string,
): EmailTemplate {
  const { type, metadata } = context;

  switch (type) {
    case "inventory_low":
      return lowInventoryAlertTemplate(
        {
          itemName: (metadata.name as string) ?? "Unknown Item",
          sku: (metadata.sku as string) ?? null,
          quantityOnHand: (metadata.quantity_on_hand as number) ?? 0,
          reorderPoint: (metadata.reorder_point as number) ?? 0,
          category: (metadata.category as string) ?? null,
        },
        appUrl,
      );

    case "order_status":
    case "order_received":
      return orderStatusChangeTemplate(
        {
          orderNumber:
            (metadata.order_number as string) ?? "Unknown",
          customerName: (metadata.customer_name as string) ?? null,
          oldStatus: (metadata.old_status as string) ?? "unknown",
          newStatus: (metadata.new_status as string) ?? "unknown",
        },
        appUrl,
      );

    case "batch_status":
      return batchStatusChangeTemplate(
        {
          batchNumber:
            (metadata.batch_number as string) ?? "Unknown",
          batchName: (metadata.batch_name as string) ?? null,
          oldStatus: (metadata.old_status as string) ?? "unknown",
          newStatus: (metadata.new_status as string) ?? "unknown",
        },
        appUrl,
      );

    default:
      return genericNotificationTemplate(context, appUrl);
  }
}
