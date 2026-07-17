import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { log } from "../client-logger";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

describe("client-logger", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // log.error
  // ---------------------------------------------------------------------------

  it("log.error forwards to captureMessage by default", () => {
    log.error("Something broke");
    expect(Sentry.captureMessage).toHaveBeenCalledWith("Something broke", {
      level: "error",
      extra: undefined,
    });
  });

  it("log.error uses captureException when an Error is in args", () => {
    const err = new Error("network failure");
    log.error("Request failed", err);
    expect(Sentry.captureException).toHaveBeenCalledWith(err, {
      level: "error",
      extra: { message: "Request failed", args: [err] },
    });
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("log.error still calls console.error", () => {
    log.error("test");
    expect(errorSpy).toHaveBeenCalledWith("test");
  });

  // ---------------------------------------------------------------------------
  // log.error — Postgrest-error-shaped plain objects (SENTRY-7597067722)
  //
  // postgrest-js wraps network-level fetch failures (offline, DNS, CORS) as a
  // plain object literal `{ message, details, hint, code }` — not an `Error`
  // instance — even though its TS type says `PostgrestError`. Without special
  // handling this silently degrades to a stack-less captureMessage.
  // ---------------------------------------------------------------------------

  it("log.error uses captureException for a Postgrest-error-shaped object (network fetch failure)", () => {
    const fetchError = {
      message: "TypeError: Failed to fetch",
      details: "TypeError: Failed to fetch\n    at fetch (...)",
      hint: "",
      code: "",
    };
    log.error("Failed to fetch notifications:", fetchError);

    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const [capturedError, captureOpts] = (Sentry.captureException as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(capturedError).toBeInstanceOf(Error);
    expect(capturedError.message).toBe(fetchError.message);
    expect(capturedError.name).toBe("PostgrestError");
    expect(capturedError.stack).toBe(fetchError.details);
    expect(captureOpts).toEqual({
      level: "error",
      extra: {
        message: "Failed to fetch notifications:",
        args: [fetchError],
        code: fetchError.code,
        hint: fetchError.hint,
        details: fetchError.details,
      },
    });
  });

  it("log.error uses captureException for a real Postgrest DB error (has a code)", () => {
    const dbError = {
      message: "permission denied for table batches",
      details: "",
      hint: null,
      code: "42501",
    };
    log.error("Failed to fetch batches:", dbError);

    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const [capturedError] = (Sentry.captureException as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(capturedError.message).toBe(dbError.message);
  });

  it("log.error still falls back to captureMessage for an unrelated plain object", () => {
    log.error("Something broke", { foo: "bar" });
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledWith("Something broke", {
      level: "error",
      extra: { args: [{ foo: "bar" }] },
    });
  });

  // ---------------------------------------------------------------------------
  // log.warn
  // ---------------------------------------------------------------------------

  it("log.warn forwards with 'warning' level (not 'warn')", () => {
    log.warn("Slow response");
    expect(Sentry.captureMessage).toHaveBeenCalledWith("Slow response", {
      level: "warning",
      extra: undefined,
    });
  });

  it("log.warn uses captureException when an Error is in args", () => {
    const err = new Error("timeout");
    log.warn("Request timed out", err);
    expect(Sentry.captureException).toHaveBeenCalledWith(err, {
      level: "warning",
      extra: { message: "Request timed out", args: [err] },
    });
  });

  it("log.warn still calls console.warn", () => {
    log.warn("test");
    expect(warnSpy).toHaveBeenCalledWith("test");
  });

  // ---------------------------------------------------------------------------
  // log.info / log.debug — Sentry-silent
  // ---------------------------------------------------------------------------

  it("log.info does not forward to Sentry", () => {
    log.info("App loaded");
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("log.debug does not forward to Sentry", () => {
    log.debug("Cache hit");
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("log.info still calls console.info", () => {
    log.info("test");
    expect(infoSpy).toHaveBeenCalledWith("test");
  });

  it("log.debug still calls console.debug", () => {
    log.debug("test");
    expect(debugSpy).toHaveBeenCalledWith("test");
  });
});
