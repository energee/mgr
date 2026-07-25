/**
 * Tests for Square integration utilities: webhook signature verification,
 * dollar-to-cents conversion, and draft volume calculation.
 */

import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import {
  DEFAULT_REPLAY_WINDOW_MS,
  PAYMENT_REPLAY_WINDOW_MS,
  checkReplayWindow,
  verifyWebhookSignature,
} from "@/integrations/square/webhook";
import {
  dollarsToCents,
} from "@/integrations/square/utils";

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
// Replay-Window Check (audit F-127 / PR #273 B-1)
// =============================================================================

describe("checkReplayWindow", () => {
  // Fixed "now" so the boundary cases are deterministic.
  const now = Date.parse("2026-05-14T12:00:00.000Z");

  it("accepts an event well inside the window", () => {
    const createdAt = new Date(now - 60_000).toISOString(); // 1 min ago
    expect(checkReplayWindow(createdAt, DEFAULT_REPLAY_WINDOW_MS, now)).toEqual({ ok: true });
  });

  it("accepts an event 4m59s in the past (just inside the 5-min window)", () => {
    const createdAt = new Date(now - (5 * 60_000 - 1_000)).toISOString();
    expect(checkReplayWindow(createdAt, DEFAULT_REPLAY_WINDOW_MS, now)).toEqual({ ok: true });
  });

  it("rejects an event 5m01s in the past as stale", () => {
    const createdAt = new Date(now - (5 * 60_000 + 1_000)).toISOString();
    expect(checkReplayWindow(createdAt, DEFAULT_REPLAY_WINDOW_MS, now)).toEqual({
      ok: false,
      reason: "stale_event",
    });
  });

  it("rejects an event from the future beyond the window (clock skew)", () => {
    const createdAt = new Date(now + (5 * 60_000 + 1_000)).toISOString();
    expect(checkReplayWindow(createdAt, DEFAULT_REPLAY_WINDOW_MS, now)).toEqual({
      ok: false,
      reason: "stale_event",
    });
  });

  it("hard-rejects a missing created_at", () => {
    expect(checkReplayWindow(undefined, DEFAULT_REPLAY_WINDOW_MS, now)).toEqual({
      ok: false,
      reason: "missing_created_at",
    });
  });

  it("hard-rejects an unparseable created_at (never silent-pass)", () => {
    expect(checkReplayWindow("not-a-date", DEFAULT_REPLAY_WINDOW_MS, now)).toEqual({
      ok: false,
      reason: "invalid_created_at",
    });
  });

  it("respects a caller-provided window", () => {
    const createdAt = new Date(now - 30_000).toISOString(); // 30s ago
    // 10s window: rejects.
    expect(checkReplayWindow(createdAt, 10_000, now)).toEqual({
      ok: false,
      reason: "stale_event",
    });
    // 60s window: accepts.
    expect(checkReplayWindow(createdAt, 60_000, now)).toEqual({ ok: true });
  });
});

// The widened payment.* window (audit IN-2): sale ingestion is exactly-once
// via the order-keyed dedup claim (UNIQUE, 00224/00233), so payment events may
// accept Square's full 24h retry horizon — a >5-min outage must not
// permanently drop the sales Square dutifully keeps retrying.
describe("PAYMENT_REPLAY_WINDOW_MS (audit IN-2)", () => {
  const now = Date.parse("2026-05-14T12:00:00.000Z");

  it("covers Square's full 24h retry horizon", () => {
    const createdAt = new Date(now - 24 * 60 * 60_000).toISOString();
    expect(checkReplayWindow(createdAt, PAYMENT_REPLAY_WINDOW_MS, now)).toEqual({ ok: true });
  });

  it("still rejects events beyond the horizon (26h) as stale", () => {
    const createdAt = new Date(now - 26 * 60 * 60_000).toISOString();
    expect(checkReplayWindow(createdAt, PAYMENT_REPLAY_WINDOW_MS, now)).toEqual({
      ok: false,
      reason: "stale_event",
    });
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

