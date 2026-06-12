/**
 * Brew Log Schema Tests
 *
 * Guards the brew_number relaxation from migration 00181: brew_number is
 * optional client-side so an empty value reaches the generate_brew_number()
 * BEFORE INSERT trigger, which assigns a unique BRW-YYYY-DDD number with a
 * dedup suffix. Re-tightening this to required would silently disable
 * server-side auto-generation.
 */

import { describe, it, expect, vi } from "vitest";

// Mock the Supabase client to avoid env var requirements during import.
// brew-log.tsx transitively imports components that call createClient()
// at module scope (e.g., revision-history-display).
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ data: [], error: null }),
    }),
  }),
}));

import { brewLogSchema } from "@/entities/brew-log";

describe("brewLogSchema brew_number (server-generated when blank)", () => {
  const base = { brew_date: "2026-06-12" };

  it("accepts an omitted brew_number (server trigger generates it)", () => {
    const result = brewLogSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("accepts an empty brew_number (server trigger generates it)", () => {
    const result = brewLogSchema.safeParse({ ...base, brew_number: "" });
    expect(result.success).toBe(true);
  });

  it("preserves an explicitly provided brew_number", () => {
    const result = brewLogSchema.parse({
      ...base,
      brew_number: "BRW-2026-163",
    });
    expect(result.brew_number).toBe("BRW-2026-163");
  });

  it("still requires brew_date", () => {
    const result = brewLogSchema.safeParse({ brew_number: "BRW-2026-163" });
    expect(result.success).toBe(false);
  });
});
