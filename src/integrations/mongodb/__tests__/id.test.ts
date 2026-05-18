import { describe, it, expect } from "vitest";
import { objectIdToUuid } from "../id";

describe("objectIdToUuid", () => {
  it("returns a valid UUID format", () => {
    const result = objectIdToUuid("507f1f77bcf86cd799439011");
    expect(result).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("is deterministic — same input always produces same output", () => {
    const id = "670ef97bb109d8c422a322e3";
    const a = objectIdToUuid(id);
    const b = objectIdToUuid(id);
    expect(a).toBe(b);
  });

  it("produces different UUIDs for different ObjectIds", () => {
    const a = objectIdToUuid("507f1f77bcf86cd799439011");
    const b = objectIdToUuid("507f1f77bcf86cd799439012");
    expect(a).not.toBe(b);
  });

  it("produces UUID v5 (version nibble = 5)", () => {
    const result = objectIdToUuid("507f1f77bcf86cd799439011");
    // UUID v5 has "5" as the 13th character (version nibble)
    expect(result[14]).toBe("5");
  });
});
