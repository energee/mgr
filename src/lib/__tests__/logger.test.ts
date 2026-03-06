/**
 * Tests for the structured logger.
 *
 * Validates log level filtering, output formatting for development and
 * production modes, child logger default merging, and console method routing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("logger", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Basic logging
  // ---------------------------------------------------------------------------

  it("logs info messages via console.log", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOG_LEVEL", "debug");
    const { logger } = await import("../logger");

    logger.info("Server started", { port: 3000 });

    expect(console.log).toHaveBeenCalledOnce();
    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(output).toContain("INFO");
    expect(output).toContain("Server started");
    expect(output).toContain("3000");
  });

  it("logs warn messages via console.warn", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOG_LEVEL", "debug");
    const { logger } = await import("../logger");

    logger.warn("Slow query", { durationMs: 500 });

    expect(console.warn).toHaveBeenCalledOnce();
    const output = (console.warn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(output).toContain("WARN");
    expect(output).toContain("Slow query");
  });

  it("logs error messages via console.error", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOG_LEVEL", "debug");
    const { logger } = await import("../logger");

    logger.error("Database unreachable", { service: "postgres" });

    expect(console.error).toHaveBeenCalledOnce();
    const output = (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(output).toContain("ERROR");
    expect(output).toContain("Database unreachable");
  });

  it("logs debug messages via console.debug", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOG_LEVEL", "debug");
    const { logger } = await import("../logger");

    logger.debug("Cache hit", { key: "recipe:123" });

    expect(console.debug).toHaveBeenCalledOnce();
    const output = (console.debug as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(output).toContain("DEBUG");
    expect(output).toContain("Cache hit");
  });

  // ---------------------------------------------------------------------------
  // Level filtering
  // ---------------------------------------------------------------------------

  it("filters out debug messages when LOG_LEVEL is info", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOG_LEVEL", "info");
    const { logger } = await import("../logger");

    logger.debug("Should not appear");

    expect(console.debug).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it("filters out debug and info when LOG_LEVEL is warn", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOG_LEVEL", "warn");
    const { logger } = await import("../logger");

    logger.debug("Nope");
    logger.info("Also nope");
    logger.warn("This should appear");

    expect(console.debug).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it("only logs errors when LOG_LEVEL is error", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOG_LEVEL", "error");
    const { logger } = await import("../logger");

    logger.debug("Nope");
    logger.info("Nope");
    logger.warn("Nope");
    logger.error("Yes");

    expect(console.debug).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledOnce();
  });

  // ---------------------------------------------------------------------------
  // Production JSON output
  // ---------------------------------------------------------------------------

  it("emits JSON in production mode", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_LEVEL", "info");
    const { logger } = await import("../logger");

    logger.info("Request handled", { route: "/api/chat", status: 200 });

    expect(console.log).toHaveBeenCalledOnce();
    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;

    // Should be parseable JSON
    const parsed = JSON.parse(output);
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("Request handled");
    expect(parsed.route).toBe("/api/chat");
    expect(parsed.status).toBe(200);
    expect(parsed.time).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Development formatted output
  // ---------------------------------------------------------------------------

  it("emits human-readable format in development mode", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOG_LEVEL", "info");
    const { logger } = await import("../logger");

    logger.info("Boot complete");

    expect(console.log).toHaveBeenCalledOnce();
    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;

    // Should NOT be JSON — should be human-readable with level and message
    expect(output).toContain("INFO");
    expect(output).toContain("Boot complete");
    // Should contain a timestamp-like pattern
    expect(output).toMatch(/\[\d{4}-\d{2}-\d{2}/);
  });

  it("includes extra data in development format", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOG_LEVEL", "info");
    const { logger } = await import("../logger");

    logger.info("With extras", { userId: "abc", action: "login" });

    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(output).toContain("userId");
    expect(output).toContain("abc");
  });

  it("omits extra data block when no data is provided in dev format", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOG_LEVEL", "info");
    const { logger } = await import("../logger");

    logger.info("No extras");

    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    // Should end with the message (no trailing JSON object)
    expect(output).toMatch(/No extras$/);
  });

  // ---------------------------------------------------------------------------
  // Child logger
  // ---------------------------------------------------------------------------

  it("child logger merges default fields into every call", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_LEVEL", "info");
    const { logger } = await import("../logger");

    const child = logger.child({ module: "chat", requestId: "req_1" });
    child.info("Processing", { step: 3 });

    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.module).toBe("chat");
    expect(parsed.requestId).toBe("req_1");
    expect(parsed.step).toBe(3);
    expect(parsed.msg).toBe("Processing");
  });

  it("child logger call-site data overrides defaults", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_LEVEL", "info");
    const { logger } = await import("../logger");

    const child = logger.child({ env: "staging" });
    child.info("Override test", { env: "production" });

    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.env).toBe("production");
  });

  it("child of child merges all defaults", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_LEVEL", "info");
    const { logger } = await import("../logger");

    const child1 = logger.child({ service: "api" });
    const child2 = child1.child({ handler: "chat" });
    child2.info("Nested");

    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.service).toBe("api");
    expect(parsed.handler).toBe("chat");
  });
});
