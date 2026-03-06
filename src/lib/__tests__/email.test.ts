/**
 * Tests for email delivery utilities.
 *
 * Mocks the Resend SDK to verify:
 * - sendEmail dispatches to Resend with correct arguments
 * - sendNotificationEmail prefixes the subject with "[MGR]"
 * - Graceful fallback when RESEND_API_KEY is not configured
 * - Error handling for Resend API failures
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the Resend SDK before importing the module under test
// ---------------------------------------------------------------------------

const mockSend = vi.fn();

vi.mock("resend", () => {
  return {
    Resend: class MockResend {
      emails = { send: mockSend };
    },
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sendEmail", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
  });

  it("returns skipped result when RESEND_API_KEY is not set", async () => {
    // Ensure env has no API key
    const originalKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;

    // Re-import to pick up env change
    const { sendEmail } = await import("../email");

    const result = await sendEmail({
      to: "user@example.com",
      subject: "Test",
      html: "<p>Hello</p>",
    });

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(mockSend).not.toHaveBeenCalled();

    // Restore
    if (originalKey) process.env.RESEND_API_KEY = originalKey;
  });

  it("sends email and returns id on success", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "test@brewery.com";

    mockSend.mockResolvedValueOnce({
      data: { id: "msg_123" },
      error: null,
    });

    const { sendEmail } = await import("../email");

    const result = await sendEmail({
      to: "user@example.com",
      subject: "Order Confirmation",
      html: "<p>Your order is confirmed</p>",
      text: "Your order is confirmed",
      replyTo: "support@brewery.com",
    });

    expect(result.ok).toBe(true);
    expect(result.id).toBe("msg_123");
    expect(mockSend).toHaveBeenCalledOnce();

    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.to).toEqual(["user@example.com"]);
    expect(callArgs.subject).toBe("Order Confirmation");
    expect(callArgs.html).toBe("<p>Your order is confirmed</p>");
    expect(callArgs.text).toBe("Your order is confirmed");
    expect(callArgs.replyTo).toBe("support@brewery.com");

    // Cleanup
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
  });

  it("returns error result when Resend API returns an error", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "test@brewery.com";

    mockSend.mockResolvedValueOnce({
      data: null,
      error: { message: "Invalid API key" },
    });

    const { sendEmail } = await import("../email");

    const result = await sendEmail({
      to: "user@example.com",
      subject: "Test",
      html: "<p>test</p>",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Invalid API key");

    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
  });

  it("returns error result when Resend throws an exception", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "test@brewery.com";

    mockSend.mockRejectedValueOnce(new Error("Network timeout"));

    const { sendEmail } = await import("../email");

    const result = await sendEmail({
      to: "user@example.com",
      subject: "Test",
      html: "<p>test</p>",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Network timeout");

    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
  });

  it("wraps single to address in an array", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "test@brewery.com";

    mockSend.mockResolvedValueOnce({ data: { id: "msg_456" }, error: null });

    const { sendEmail } = await import("../email");

    await sendEmail({
      to: "solo@example.com",
      subject: "Test",
      html: "<p>Hello</p>",
    });

    expect(mockSend.mock.calls[0][0].to).toEqual(["solo@example.com"]);

    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
  });

  it("passes array of recipients as-is", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "test@brewery.com";

    mockSend.mockResolvedValueOnce({ data: { id: "msg_789" }, error: null });

    const { sendEmail } = await import("../email");

    await sendEmail({
      to: ["a@example.com", "b@example.com"],
      subject: "Test",
      html: "<p>Hello</p>",
    });

    expect(mockSend.mock.calls[0][0].to).toEqual([
      "a@example.com",
      "b@example.com",
    ]);

    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
  });
});

describe("sendNotificationEmail", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
  });

  it("prefixes subject with [MGR]", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "test@brewery.com";

    mockSend.mockResolvedValueOnce({ data: { id: "msg_notif" }, error: null });

    const { sendNotificationEmail } = await import("../email");

    await sendNotificationEmail(
      "admin@example.com",
      "Low Inventory Alert",
      "<p>Stock is low</p>",
      "Stock is low",
    );

    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend.mock.calls[0][0].subject).toBe("[MGR] Low Inventory Alert");

    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
  });
});
