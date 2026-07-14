/**
 * Tests for the structured logger (pino).
 *
 * Validates log level filtering, JSON output, child logger merging,
 * and message formatting. Pino writes to process.stdout, so we capture
 * output by mocking process.stdout.write.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

/** Capture pino JSON output by intercepting process.stdout.write */
function captureStdout() {
  const lines: string[] = [];
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      const str = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      if (str.trim()) lines.push(str.trim());
      return true;
    });
  return {
    lines,
    /** Parse the last JSON line written to stdout */
    lastJson(): Record<string, unknown> {
      if (lines.length === 0) throw new Error("No output captured");
      return JSON.parse(lines[lines.length - 1]);
    },
    hasOutput: () => lines.length > 0,
    restore: () => spy.mockRestore(),
  };
}

describe("logger", () => {
  let capture: ReturnType<typeof captureStdout>;

  beforeEach(() => {
    vi.resetModules();
    capture = captureStdout();
  });

  afterEach(() => {
    capture.restore();
    vi.unstubAllEnvs();
  });

  // ---------------------------------------------------------------------------
  // Basic logging
  // ---------------------------------------------------------------------------

  it("logs info messages with correct level", async () => {
    vi.stubEnv("LOG_LEVEL", "debug");
    const { logger } = await import("../logger");

    logger.info({ port: 3000 }, "Server started");

    const parsed = capture.lastJson();
    expect(parsed.level).toBe(30); // pino info = 30
    expect(parsed.msg).toBe("Server started");
    expect(parsed.port).toBe(3000);
  });

  it("logs warn messages with correct level", async () => {
    vi.stubEnv("LOG_LEVEL", "debug");
    const { logger } = await import("../logger");

    logger.warn({ durationMs: 500 }, "Slow query");

    const parsed = capture.lastJson();
    expect(parsed.level).toBe(40); // pino warn = 40
    expect(parsed.msg).toBe("Slow query");
    expect(parsed.durationMs).toBe(500);
  });

  it("logs error messages with correct level", async () => {
    vi.stubEnv("LOG_LEVEL", "debug");
    const { logger } = await import("../logger");

    logger.error({ service: "postgres" }, "Database unreachable");

    const parsed = capture.lastJson();
    expect(parsed.level).toBe(50); // pino error = 50
    expect(parsed.msg).toBe("Database unreachable");
    expect(parsed.service).toBe("postgres");
  });

  it("logs debug messages with correct level", async () => {
    vi.stubEnv("LOG_LEVEL", "debug");
    const { logger } = await import("../logger");

    logger.debug({ key: "recipe:123" }, "Cache hit");

    const parsed = capture.lastJson();
    expect(parsed.level).toBe(20); // pino debug = 20
    expect(parsed.msg).toBe("Cache hit");
    expect(parsed.key).toBe("recipe:123");
  });

  // ---------------------------------------------------------------------------
  // Level filtering
  // ---------------------------------------------------------------------------

  it("filters out debug messages when LOG_LEVEL is info", async () => {
    vi.stubEnv("LOG_LEVEL", "info");
    const { logger } = await import("../logger");

    logger.debug("Should not appear");

    expect(capture.hasOutput()).toBe(false);
  });

  it("filters out debug and info when LOG_LEVEL is warn", async () => {
    vi.stubEnv("LOG_LEVEL", "warn");
    const { logger } = await import("../logger");

    logger.debug("Nope");
    logger.info("Also nope");

    const linesBefore = capture.lines.length;

    logger.warn("This should appear");

    expect(capture.lines.length).toBe(linesBefore + 1);
    const parsed = capture.lastJson();
    expect(parsed.msg).toBe("This should appear");
  });

  it("only logs errors when LOG_LEVEL is error", async () => {
    vi.stubEnv("LOG_LEVEL", "error");
    const { logger } = await import("../logger");

    logger.debug("Nope");
    logger.info("Nope");
    logger.warn("Nope");

    const linesBefore = capture.lines.length;

    logger.error("Yes");

    expect(capture.lines.length).toBe(linesBefore + 1);
    const parsed = capture.lastJson();
    expect(parsed.msg).toBe("Yes");
  });

  // ---------------------------------------------------------------------------
  // JSON output
  // ---------------------------------------------------------------------------

  it("emits valid JSON with timestamp", async () => {
    vi.stubEnv("LOG_LEVEL", "info");
    const { logger } = await import("../logger");

    logger.info({ route: "/api/chat", status: 200 }, "Request handled");

    const parsed = capture.lastJson();
    expect(parsed.level).toBe(30);
    expect(parsed.msg).toBe("Request handled");
    expect(parsed.route).toBe("/api/chat");
    expect(parsed.status).toBe(200);
    expect(parsed.time).toBeDefined();
  });

  it("includes message-only log without extra data", async () => {
    vi.stubEnv("LOG_LEVEL", "info");
    const { logger } = await import("../logger");

    logger.info("Boot complete");

    const parsed = capture.lastJson();
    expect(parsed.msg).toBe("Boot complete");
    expect(parsed.time).toBeDefined();
  });

  it("includes extra data fields in output", async () => {
    vi.stubEnv("LOG_LEVEL", "info");
    const { logger } = await import("../logger");

    logger.info({ userId: "abc", action: "login" }, "With extras");

    const parsed = capture.lastJson();
    expect(parsed.msg).toBe("With extras");
    expect(parsed.userId).toBe("abc");
    expect(parsed.action).toBe("login");
  });

  // ---------------------------------------------------------------------------
  // Child logger
  // ---------------------------------------------------------------------------

  it("child logger merges default fields into every call", async () => {
    vi.stubEnv("LOG_LEVEL", "info");
    const { logger } = await import("../logger");

    const child = logger.child({ module: "chat", requestId: "req_1" });
    child.info({ step: 3 }, "Processing");

    const parsed = capture.lastJson();
    expect(parsed.module).toBe("chat");
    expect(parsed.requestId).toBe("req_1");
    expect(parsed.step).toBe(3);
    expect(parsed.msg).toBe("Processing");
  });

  it("child logger call-site data overrides defaults", async () => {
    vi.stubEnv("LOG_LEVEL", "info");
    const { logger } = await import("../logger");

    const child = logger.child({ env: "staging" });
    child.info({ env: "production" }, "Override test");

    const parsed = capture.lastJson();
    expect(parsed.env).toBe("production");
  });

  it("child of child merges all defaults", async () => {
    vi.stubEnv("LOG_LEVEL", "info");
    const { logger } = await import("../logger");

    const child1 = logger.child({ service: "api" });
    const child2 = child1.child({ handler: "chat" });
    child2.info("Nested");

    const parsed = capture.lastJson();
    expect(parsed.service).toBe("api");
    expect(parsed.handler).toBe("chat");
  });

  // ---------------------------------------------------------------------------
  // Sentry forwarding
  // ---------------------------------------------------------------------------

  describe("Sentry forwarding", () => {
    async function setup() {
      const sentry = await import("@sentry/nextjs");
      vi.clearAllMocks();
      const { logger } = await import("../logger");
      return { sentry, logger };
    }

    it("calls captureException when first arg is an Error", async () => {
      const { sentry, logger } = await setup();
      const err = new Error("boom");
      logger.error(err);
      expect(sentry.captureException).toHaveBeenCalledWith(err, { level: "error" });
      expect(sentry.captureMessage).not.toHaveBeenCalled();
    });

    it("calls captureException with extra when { err, ...ctx } + message", async () => {
      const { sentry, logger } = await setup();
      const err = new Error("db down");
      logger.error({ err, service: "postgres" }, "Database unreachable");
      expect(sentry.captureException).toHaveBeenCalledWith(err, {
        level: "error",
        extra: { service: "postgres" },
      });
    });

    it("calls captureMessage with ctx when { ...ctx } + message (no err key)", async () => {
      const { sentry, logger } = await setup();
      logger.error({ service: "postgres" }, "Database unreachable");
      expect(sentry.captureMessage).toHaveBeenCalledWith("Database unreachable", {
        level: "error",
        extra: { service: "postgres" },
      });
    });

    it("calls captureMessage when first arg is a string", async () => {
      const { sentry, logger } = await setup();
      logger.error("Something went wrong");
      expect(sentry.captureMessage).toHaveBeenCalledWith("Something went wrong", {
        level: "error",
      });
    });

    // SENTRY-7542174707 regression: a pino printf-style call
    // (logger.error("... %s ...", a, b)) must have its placeholders
    // interpolated before being forwarded to Sentry. Previously the bare,
    // un-interpolated template string was sent as-is, so Sentry captured
    // "Upsert error for %s batch %d: %s" with none of the table name, batch
    // index, or actual Postgres error message — making the issue
    // undiagnosable from the Sentry event alone.
    it("interpolates printf-style placeholders before forwarding to Sentry", async () => {
      const { sentry, logger } = await setup();
      logger.error(
        "Upsert error for %s batch %d: %s",
        "brands",
        2,
        "duplicate key value violates unique constraint"
      );
      expect(sentry.captureMessage).toHaveBeenCalledWith(
        "Upsert error for brands batch 2: duplicate key value violates unique constraint",
        {
          level: "error",
          extra: { args: ["brands", 2, "duplicate key value violates unique constraint"] },
        }
      );
    });

    it("does not treat a literal % with no known specifier as a placeholder", async () => {
      const { sentry, logger } = await setup();
      logger.error("100% failure rate");
      expect(sentry.captureMessage).toHaveBeenCalledWith("100% failure rate", {
        level: "error",
      });
    });

    it("uses '(no message)' fallback when obj has no string message arg", async () => {
      const { sentry, logger } = await setup();
      logger.error({ service: "postgres" });
      expect(sentry.captureMessage).toHaveBeenCalledWith("(no message)", {
        level: "error",
        extra: { service: "postgres" },
      });
    });

    it("uses 'fatal' severity for logger.fatal calls", async () => {
      const { sentry, logger } = await setup();
      logger.fatal("Critical failure");
      expect(sentry.captureMessage).toHaveBeenCalledWith("Critical failure", {
        level: "fatal",
      });
    });

    it("does not forward info, debug, or warn to Sentry", async () => {
      vi.stubEnv("LOG_LEVEL", "debug");
      const { sentry, logger } = await setup();
      logger.info("Info message");
      logger.debug("Debug message");
      logger.warn("Warn message");
      expect(sentry.captureException).not.toHaveBeenCalled();
      expect(sentry.captureMessage).not.toHaveBeenCalled();
    });
  });
});
