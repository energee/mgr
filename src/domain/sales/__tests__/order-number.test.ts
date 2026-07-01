/**
 * Characterization tests for order-number.ts
 *
 * Pins current behavior of `generateNextOrderNumber`, the sales-side sibling
 * of `generateNextPONumber` (src/domain/purchasing/po-generator.ts). Mocks
 * the lazily-imported Supabase client's `rpc` call plus the client logger,
 * following the pattern in src/domain/purchasing/__tests__/landed-cost.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/client-logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const rpcMock = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: rpcMock,
  }),
}));

import { generateNextOrderNumber } from "../order-number";
import { log } from "@/lib/client-logger";

describe("generateNextOrderNumber", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    vi.mocked(log.error).mockClear();
  });

  it("calls the generate_next_order_number RPC with no arguments", async () => {
    rpcMock.mockResolvedValueOnce({ data: "ORD-2026-001", error: null });
    await generateNextOrderNumber();
    expect(rpcMock).toHaveBeenCalledWith("generate_next_order_number");
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("resolves with the order number returned by the RPC", async () => {
    rpcMock.mockResolvedValueOnce({ data: "ORD-2026-042", error: null });
    const result = await generateNextOrderNumber();
    expect(result).toBe("ORD-2026-042");
  });

  it("passes through whatever `data` the RPC returns without validation (quirk: no format check)", async () => {
    // The implementation does not verify the ORD-YYYY-NNN shape or even that
    // `data` is a string -- it returns whatever the RPC gives back as-is.
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const result = await generateNextOrderNumber();
    expect(result).toBeNull();
  });

  it("logs and throws the RPC error object when the call fails", async () => {
    const rpcError = { message: "advisory lock timeout" };
    rpcMock.mockResolvedValueOnce({ data: null, error: rpcError });

    await expect(generateNextOrderNumber()).rejects.toEqual(rpcError);
    expect(log.error).toHaveBeenCalledWith(
      "Error generating order number:",
      rpcError,
    );
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it("does not call the logger on success", async () => {
    rpcMock.mockResolvedValueOnce({ data: "ORD-2026-001", error: null });
    await generateNextOrderNumber();
    expect(log.error).not.toHaveBeenCalled();
  });
});
