/**
 * Email Delivery via Resend
 *
 * Server-side utility for sending transactional emails using the Resend API.
 * If RESEND_API_KEY is not configured, email sending is silently skipped
 * with a console warning — this allows the app to run without email in
 * development environments.
 */

import { Resend } from "resend";
import { logger } from "@/lib/logger";

// -- Configuration ------------------------------------------------------------

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL_DEFAULT = "MGR Brewery <noreply@yourdomain.com>";
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? FROM_EMAIL_DEFAULT;

if (RESEND_API_KEY && FROM_EMAIL === FROM_EMAIL_DEFAULT) {
  logger.warn(
    "[email] RESEND_API_KEY is set but RESEND_FROM_EMAIL is not configured. " +
      "Emails will fail because the default domain is not verified with Resend. " +
      "Set RESEND_FROM_EMAIL in your environment variables.",
  );
}

/** Lazily initialized Resend client; null when API key is missing. */
let resendClient: Resend | null = null;

function getClient(): Resend | null {
  if (!RESEND_API_KEY) {
    return null;
  }
  if (!resendClient) {
    resendClient = new Resend(RESEND_API_KEY);
  }
  return resendClient;
}

// -- Types --------------------------------------------------------------------

export interface SendEmailOptions {
  /** Recipient email address (or array of addresses). */
  to: string | string[];
  /** Email subject line. */
  subject: string;
  /** HTML body content. */
  html: string;
  /** Optional plain-text fallback body. */
  text?: string;
  /** Optional reply-to address. */
  replyTo?: string;
}

export interface SendEmailResult {
  /** Whether the email was sent (or skipped) successfully. */
  ok: boolean;
  /** Resend message ID on success. */
  id?: string;
  /** Error message on failure. */
  error?: string;
  /** True when sending was skipped because no API key is configured. */
  skipped?: boolean;
}

// -- Public API ---------------------------------------------------------------

/**
 * Send a single email via Resend.
 *
 * Returns `{ ok: true, id }` on success, `{ ok: true, skipped: true }` when
 * the API key is not configured, or `{ ok: false, error }` on failure.
 */
export async function sendEmail(
  options: SendEmailOptions,
): Promise<SendEmailResult> {
  const client = getClient();

  if (!client) {
    logger.warn("[email] RESEND_API_KEY not set — skipping email: %s", options.subject);
    return { ok: true, skipped: true };
  }

  try {
    const { data, error } = await client.emails.send({
      from: FROM_EMAIL,
      to: Array.isArray(options.to) ? options.to : [options.to],
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
    });

    if (error) {
      logger.error("[email] Resend API error: %s", error.message);
      return { ok: false, error: error.message };
    }

    return { ok: true, id: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[email] Failed to send: %s", message);
    return { ok: false, error: message };
  }
}

/**
 * Send an internal notification email (e.g. alerts, status changes).
 *
 * Convenience wrapper around `sendEmail` that prefixes the subject with
 * "[MGR]" for easy inbox filtering.
 */
export async function sendNotificationEmail(
  to: string | string[],
  subject: string,
  html: string,
  text?: string,
): Promise<SendEmailResult> {
  return sendEmail({
    to,
    subject: `[MGR] ${subject}`,
    html,
    text,
  });
}
