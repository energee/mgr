/**
 * Tests for Square integration utilities: webhook signature verification,
 * dollar-to-cents conversion, and draft volume calculation.
 */

import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { verifyWebhookSignature } from "../square/webhook";
import {
  dollarsToCents,
  calculateVolumeOz,
  STANDARD_POUR_OZ,
} from "../square/utils";

// =============================================================================
// Webhook Signature Verification
// =============================================================================

describe("verifyWebhookSignature", () => {
  const signatureKey = "test-signature-key-abc123";
  const notificationUrl = "https://myapp.example.com/api/square/webhook";

  /** Helper to compute a valid HMAC-SHA256 signature the way Square does. */
  function computeSignature(body: string): string {
    const hmac = createHmac("sha256", signatureKey);
    hmac.update(notificationUrl + body);
    return hmac.digest("base64");
  }

  it("accepts a valid signature", () => {
    const body = JSON.stringify({ type: "payment.completed", event_id: "ev1" });
    const signature = computeSignature(body);

    expect(verifyWebhookSignature(body, signature, signatureKey, notificationUrl)).toBe(true);
  });

  it("rejects an invalid signature (wrong body)", () => {
    const body = JSON.stringify({ type: "payment.completed", event_id: "ev1" });
    const signature = computeSignature(body);

    const tamperedBody = JSON.stringify({ type: "payment.completed", event_id: "ev2" });
    expect(verifyWebhookSignature(tamperedBody, signature, signatureKey, notificationUrl)).toBe(false);
  });

  it("rejects a completely bogus signature", () => {
    const body = JSON.stringify({ type: "test" });
    expect(verifyWebhookSignature(body, "not-a-real-signature", signatureKey, notificationUrl)).toBe(false);
  });

  it("rejects when signature key differs", () => {
    const body = JSON.stringify({ type: "payment.completed" });
    const signature = computeSignature(body);

    expect(verifyWebhookSignature(body, signature, "wrong-key", notificationUrl)).toBe(false);
  });

  it("rejects when notification URL differs", () => {
    const body = JSON.stringify({ type: "payment.completed" });
    const signature = computeSignature(body);

    expect(
      verifyWebhookSignature(body, signature, signatureKey, "https://other.example.com/webhook")
    ).toBe(false);
  });

  it("handles empty body with valid signature", () => {
    const body = "";
    const signature = computeSignature(body);

    expect(verifyWebhookSignature(body, signature, signatureKey, notificationUrl)).toBe(true);
  });

  it("is sensitive to trailing slash in notification URL", () => {
    const body = JSON.stringify({ type: "test" });
    // Compute with trailing slash
    const hmac = createHmac("sha256", signatureKey);
    hmac.update(notificationUrl + "/" + body);
    const sigWithSlash = hmac.digest("base64");

    // Verify with no-slash URL should fail
    expect(verifyWebhookSignature(body, sigWithSlash, signatureKey, notificationUrl)).toBe(false);
  });
});

// =============================================================================
// Dollar-to-Cents Conversion
// =============================================================================

describe("dollarsToCents", () => {
  it("converts whole dollar amounts", () => {
    expect(dollarsToCents(10)).toBe(1000);
    expect(dollarsToCents(1)).toBe(100);
    expect(dollarsToCents(0)).toBe(0);
  });

  it("converts typical beer prices", () => {
    expect(dollarsToCents(5.99)).toBe(599);
    expect(dollarsToCents(7.5)).toBe(750);
    expect(dollarsToCents(12.99)).toBe(1299);
  });

  it("handles the classic floating-point trap (10.13 * 100)", () => {
    // Without Math.round, 10.13 * 100 === 1012.9999999999999
    expect(dollarsToCents(10.13)).toBe(1013);
  });

  it("handles other known floating-point edge cases", () => {
    expect(dollarsToCents(0.1)).toBe(10);
    expect(dollarsToCents(0.2)).toBe(20);
    // 1.005 * 100 = 100.49999... in IEEE 754, so Math.round gives 100
    expect(dollarsToCents(1.005)).toBe(100);
    expect(dollarsToCents(19.99)).toBe(1999);
    expect(dollarsToCents(9.99)).toBe(999);
  });

  it("handles negative amounts (refunds)", () => {
    expect(dollarsToCents(-5.99)).toBe(-599);
    expect(dollarsToCents(-10.13)).toBe(-1013);
  });

  it("handles very small amounts", () => {
    expect(dollarsToCents(0.01)).toBe(1);
    expect(dollarsToCents(0.001)).toBe(0); // sub-cent rounds to 0
  });
});

// =============================================================================
// Draft Volume Calculation
// =============================================================================

describe("calculateVolumeOz", () => {
  it("calculates volume for a single pour", () => {
    expect(calculateVolumeOz(1)).toBe(STANDARD_POUR_OZ);
    expect(calculateVolumeOz(1)).toBe(16);
  });

  it("calculates volume for multiple pours", () => {
    expect(calculateVolumeOz(3)).toBe(48);
    expect(calculateVolumeOz(10)).toBe(160);
  });

  it("returns 0 for zero quantity", () => {
    expect(calculateVolumeOz(0)).toBe(0);
  });

  it("handles fractional quantities", () => {
    // Half a pour (e.g., taster)
    expect(calculateVolumeOz(0.5)).toBe(8);
  });
});
