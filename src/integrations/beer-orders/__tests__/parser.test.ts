/** Regression coverage for both supported Beer Orders workbook layouts. */

import { beforeEach, describe, expect, it, vi } from "vitest";

const excelMocks = vi.hoisted(() => ({
  readSheetNames: vi.fn(),
  readXlsxFile: vi.fn(),
}));

vi.mock("read-excel-file/node", () => ({
  default: excelMocks.readXlsxFile,
  readSheetNames: excelMocks.readSheetNames,
}));

import { parseBeerOrderWorkbook } from "../parser";

const priceRows = [
  ["Tier", "Name", "Half", "Sixtel", "Case"],
  [3, "Distributor 3", 168, 79, 58],
];

const modernRows = [
  ["Order Date", "Pickup", "Sarene East", "Style", "Price Tier", "Half", "Sixtel", "Case"],
  [new Date("2026-07-15T00:00:00Z"), null, "Verus IPA", "IPA", 3, 2, 0, 4],
  [], [], [], [], [],
  ["Order Date", "Pickup", "In House", "Style", "Price Tier", "Half", "Sixtel", "Case"],
  [new Date("2026-07-15T00:00:00Z"), null, "Verus", "IPA", 3, 1, 0, 0],
];

const legacyRows = [
  ["Order Date", "Variant", "East Half", "East Sixtel", "East Case", "West Half", "West Sixtel", "West Case"],
  [new Date("2024-04-24T00:00:00Z"), "Lupula", 1, 2, 3, 4, 5, 6],
];

beforeEach(() => {
  vi.clearAllMocks();
  excelMocks.readSheetNames.mockResolvedValue(["Price Tiers", "7-15-26", "4-24-24"]);
  excelMocks.readXlsxFile.mockImplementation(async (_buffer, options) => {
    if (options.sheet === "Price Tiers") return priceRows;
    if (options.sheet === "7-15-26") return modernRows;
    return legacyRows;
  });
});

describe("parseBeerOrderWorkbook", () => {
  it("parses modern and legacy sheets while excluding In House blocks", async () => {
    const parsed = await parseBeerOrderWorkbook(Buffer.from("fixture"));

    expect(parsed.orders).toHaveLength(3);
    expect(parsed.orders[0]).toMatchObject({
      customerLabel: "Sarene East",
      orderDate: "2026-07-15",
      lines: [
        { beer: "Verus IPA", formatKey: "half", quantity: 2, tier: 3 },
        { beer: "Verus IPA", formatKey: "case", quantity: 4, tier: 3 },
      ],
    });
    expect(parsed.orders.slice(1).map((order) => order.customerLabel)).toEqual([
      "Sarene East",
      "Sarene West",
    ]);
    expect(parsed.skippedInternalBlocks).toBe(1);
    expect(parsed.prices[3]).toEqual({ half: 168, sixtel: 79, case: 58 });
  });

  it("rejects fractional quantities instead of silently rounding", async () => {
    excelMocks.readSheetNames.mockResolvedValue(["Price Tiers", "7-15-26"]);
    excelMocks.readXlsxFile.mockImplementation(async (_buffer, options) =>
      options.sheet === "Price Tiers"
        ? priceRows
        : [modernRows[0], [new Date("2026-07-15T00:00:00Z"), null, "Verus", "IPA", 3, 1.5, 0, 0]],
    );

    await expect(parseBeerOrderWorkbook(Buffer.from("fixture"))).rejects.toThrow(
      "quantity must be a whole number",
    );
  });
});
