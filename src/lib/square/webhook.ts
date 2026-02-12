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
