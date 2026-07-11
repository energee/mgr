import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verify a Square webhook signature.
 *
 * Square signs webhooks with HMAC-SHA256:
 *   signature = base64( hmac-sha256( signatureKey, notificationUrl + body ) )
 *
 * The notificationUrl is the full URL Square sends the webhook to (configured
 * in the Square Developer Dashboard). It must match exactly, including protocol
 * and trailing slash.
 *
 * @param body        - The raw request body as a string
 * @param signature   - The value of the `x-square-hmacsha256-signature` header
 * @param signatureKey - The webhook signature key from Square settings
 * @param notificationUrl - The webhook endpoint URL as configured in Square
 * @returns true if the signature is valid
 */
export function verifyWebhookSignature(
  body: string,
  signature: string,
  signatureKey: string,
  notificationUrl: string
): boolean {
  const hmac = createHmac("sha256", signatureKey);
  hmac.update(notificationUrl + body);
  const expectedSignature = hmac.digest("base64");

  const sigBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (sigBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(sigBuffer, expectedBuffer);
}

/**
 * Default replay window: 5 minutes either side of `now`.
 *
 * Square delivers webhooks within seconds, but we allow a generous window to
 * tolerate clock skew between Square's edge and our server. Anything older
 * is treated as a replay and ignored. The check runs on `event.created_at`
 * (which is HMAC-signed, so it cannot be tampered with by the caller).
 */
export const DEFAULT_REPLAY_WINDOW_MS = 5 * 60 * 1000;

/**
 * Replay window for `payment.*` events: Square's retry horizon (24h of
 * exponential backoff on non-2xx responses) plus an hour of clock-skew slack.
 *
 * Payment events can safely accept late retries because sale ingestion is
 * exactly-once INDEPENDENT of this window (audit IN-2): the route claims the
 * Square ORDER id under a UNIQUE constraint
 * (uniq_square_sync_log_square_payment_id, migrations 00224/00233) before any
 * side effect, so a replayed event dedups against the completed claim. Under
 * the tight DEFAULT_REPLAY_WINDOW_MS, any outage longer than 5 minutes
 * permanently dropped every sale delivered during it — Square kept retrying
 * for 24h, but each retry read as "stale" and was 200-acknowledged. Event
 * types WITHOUT an unconditional dedup key (inventory.count.updated dedups
 * only when event_id is present) must keep the tight default window.
 */
export const PAYMENT_REPLAY_WINDOW_MS = 25 * 60 * 60 * 1000;

export type ReplayCheck =
  | { ok: true }
  | { ok: false; reason: "missing_created_at" | "invalid_created_at" | "stale_event" };

/**
 * Validate that a webhook event's signed `created_at` timestamp falls within
 * the allowed replay window. Must be called **after** signature verification
 * and JSON parsing — `created_at` is inside the signed body, never trust a
 * header.
 *
 * Behaviour:
 *   - missing `created_at` → `missing_created_at` (hard reject, never silent-pass)
 *   - non-ISO / unparseable `created_at` → `invalid_created_at`
 *   - |now - created_at| > windowMs → `stale_event`
 *
 * @param createdAt - The `event.created_at` field from the parsed event
 * @param windowMs - Tolerance window in ms either side of `now` (default 5 min)
 * @param now - Override for `Date.now()` (test seam)
 */
export function checkReplayWindow(
  createdAt: string | undefined,
  windowMs: number = DEFAULT_REPLAY_WINDOW_MS,
  now: number = Date.now()
): ReplayCheck {
  if (!createdAt) return { ok: false, reason: "missing_created_at" };
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return { ok: false, reason: "invalid_created_at" };
  if (Math.abs(now - t) > windowMs) return { ok: false, reason: "stale_event" };
  return { ok: true };
}
