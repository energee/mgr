/** Server-side parser for the two historical Beer Orders workbook layouts. */

import readXlsxFile, { readSheetNames } from "read-excel-file/node";
import type {
  BeerOrderFormatKey,
  BeerOrderPriceMatrix,
  ParsedBeerOrderWorkbook,
  RawBeerOrder,
  RawBeerOrderLine,
} from "./types";

type WorkbookCell = string | number | boolean | Date | null;
type WorkbookRows = WorkbookCell[][];

const FORMAT_KEYS: BeerOrderFormatKey[] = ["half", "sixtel", "case"];

export function normalizeBeerOrderValue(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll("&", " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function beerBase(value: unknown): string {
  return String(value ?? "").trim().split(/\s*\(/, 1)[0]?.trim() ?? "";
}

function columnName(column: number): string {
  let value = column;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function cell(rows: WorkbookRows, row: number, column: number): WorkbookCell {
  return rows[row - 1]?.[column - 1] ?? null;
}

function wholeQuantity(value: unknown, sheet: string, coordinate: string): number {
  if (value === null || value === undefined || value === "") return 0;
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || !Number.isInteger(quantity)) {
    throw new Error(`${sheet}!${coordinate}: quantity must be a whole number, got ${String(value)}`);
  }
  if (quantity < 0) throw new Error(`${sheet}!${coordinate}: quantity cannot be negative`);
  return quantity;
}

function isoDate(value: unknown): string | null {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) return null;
  return [
    value.getUTCFullYear(),
    String(value.getUTCMonth() + 1).padStart(2, "0"),
    String(value.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function dateFromSheetTitle(title: string): string {
  const match = /^(\d{1,2})-(\d{1,2})-(\d{2})$/.exec(title);
  if (!match) throw new Error(`${title}: expected an MM-DD-YY order sheet name`);
  const [, month, day, year] = match;
  return `20${year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}`;
}

function parsePriceMatrix(rows: WorkbookRows | undefined): BeerOrderPriceMatrix {
  if (!rows) throw new Error('Workbook is missing the required "Price Tiers" sheet');
  const prices: BeerOrderPriceMatrix = {};
  rows.forEach((row, index) => {
    const rawTier = row[0];
    if (typeof rawTier !== "number" || !Number.isInteger(rawTier) || rawTier < 1 || rawTier > 7) return;
    const values = [row[2], row[3], row[4]].map(Number);
    if (values.some((price) => !Number.isFinite(price) || price <= 0)) {
      throw new Error(`Price Tiers row ${index + 1}: half, sixtel, and case prices must be positive`);
    }
    prices[rawTier] = { half: values[0]!, sixtel: values[1]!, case: values[2]! };
  });
  if (Object.keys(prices).length === 0) throw new Error("Price Tiers has no usable distributor prices");
  return prices;
}

function parseLegacySheet(name: string, rows: WorkbookRows): RawBeerOrder[] {
  const legacyRows: Array<{ orderDate: string; beer: string; quantities: number[] }> = [];
  for (let row = 2; row <= rows.length; row += 1) {
    const beer = cell(rows, row, 2);
    if (!beer) break;
    const orderDate = isoDate(cell(rows, row, 1));
    if (!orderDate) throw new Error(`${name}!A${row}: missing order date`);
    const quantities = Array.from({ length: 6 }, (_, index) => {
      const column = index + 3;
      return wholeQuantity(cell(rows, row, column), name, `${columnName(column)}${row}`);
    });
    legacyRows.push({ orderDate, beer: beerBase(beer), quantities });
  }
  if (legacyRows.length === 0) return [];

  return ([
    ["Sarene East", 0],
    ["Sarene West", 3],
  ] as const).flatMap(([customerLabel, offset]) => {
    const lines: RawBeerOrderLine[] = [];
    legacyRows.forEach((row) => {
      FORMAT_KEYS.forEach((formatKey, index) => {
        const quantity = row.quantities[offset + index] ?? 0;
        if (quantity > 0) lines.push({ beer: row.beer, formatKey, quantity, tier: null, styleLabel: "" });
      });
    });
    return lines.length > 0
      ? [{
          sheet: name,
          customerLabel,
          orderDate: legacyRows[0]!.orderDate,
          requestedDate: null,
          lines,
        }]
      : [];
  });
}

function parseModernSheet(name: string, rows: WorkbookRows): {
  orders: RawBeerOrder[];
  skippedInternalBlocks: number;
  skippedInactiveBlocks: number;
} {
  const headers: Array<{ row: number; values: string[] }> = [];
  for (let row = 1; row <= Math.min(rows.length, 200); row += 1) {
    const values = Array.from({ length: 10 }, (_, index) => normalizeBeerOrderValue(cell(rows, row, index + 1)));
    if (FORMAT_KEYS.every((label) => values.includes(label))) headers.push({ row, values });
  }

  const orders: RawBeerOrder[] = [];
  let skippedInternalBlocks = 0;
  let skippedInactiveBlocks = 0;
  headers.forEach((header, index) => {
    const customerLabel = String(cell(rows, header.row, 3) ?? "").trim();
    const customerKey = normalizeBeerOrderValue(customerLabel);
    if (customerKey.includes("in house")) {
      skippedInternalBlocks += 1;
      return;
    }
    if (!customerKey || customerKey.startsWith("customer totals") || customerKey.includes("not active") || customerKey === "blank") {
      skippedInactiveBlocks += 1;
      return;
    }

    const columns = Object.fromEntries(
      FORMAT_KEYS.map((key) => [key, header.values.indexOf(key) + 1]),
    ) as Record<BeerOrderFormatKey, number>;
    const tierIndex = header.values.indexOf("price tier");
    const tierColumn = tierIndex >= 0 ? tierIndex + 1 : null;
    const endRow = headers[index + 1]?.row ?? header.row + 7;
    const lines: RawBeerOrderLine[] = [];
    const orderDates = new Set<string>();
    const requestedDates = new Set<string>();

    for (let row = header.row + 1; row < endRow; row += 1) {
      const beer = cell(rows, row, 3);
      if (!beer) continue;
      const rawTier = tierColumn ? cell(rows, row, tierColumn) : null;
      const tier = typeof rawTier === "number" && Number.isInteger(rawTier) ? rawTier : null;
      const styleLabel = String(cell(rows, row, 4) ?? "").trim();
      let hasQuantity = false;
      FORMAT_KEYS.forEach((formatKey) => {
        const column = columns[formatKey];
        const quantity = wholeQuantity(cell(rows, row, column), name, `${columnName(column)}${row}`);
        if (quantity > 0) {
          hasQuantity = true;
          lines.push({ beer: beerBase(beer), formatKey, quantity, tier, styleLabel });
        }
      });
      if (hasQuantity) {
        const orderDate = isoDate(cell(rows, row, 1));
        const requestedDate = isoDate(cell(rows, row, 2));
        if (orderDate) orderDates.add(orderDate);
        if (requestedDate) requestedDates.add(requestedDate);
      }
    }

    if (lines.length === 0) return;
    if (orderDates.size > 1 || requestedDates.size > 1) {
      throw new Error(`${name} ${customerLabel}: mixed dates order=${[...orderDates].join(",")} pickup=${[...requestedDates].join(",")}`);
    }
    orders.push({
      sheet: name,
      customerLabel,
      orderDate: [...orderDates][0] ?? dateFromSheetTitle(name),
      requestedDate: [...requestedDates][0] ?? null,
      lines,
    });
  });
  return { orders, skippedInternalBlocks, skippedInactiveBlocks };
}

export async function parseBeerOrderWorkbook(buffer: Buffer): Promise<ParsedBeerOrderWorkbook> {
  const sheetNames = await readSheetNames(buffer);
  if (sheetNames[0] !== "Price Tiers") throw new Error('The first sheet must be "Price Tiers"');
  const sheets = new Map<string, WorkbookRows>();
  for (const name of sheetNames) {
    sheets.set(name, await readXlsxFile(buffer, { sheet: name }) as WorkbookRows);
  }
  const prices = parsePriceMatrix(sheets.get("Price Tiers"));
  const orders: RawBeerOrder[] = [];
  let skippedInternalBlocks = 0;
  let skippedInactiveBlocks = 0;
  sheetNames.slice(1).forEach((name) => {
    const rows = sheets.get(name)!;
    const firstRow = Array.from({ length: 10 }, (_, index) => normalizeBeerOrderValue(cell(rows, 1, index + 1)));
    if (firstRow[1] === "variant") {
      orders.push(...parseLegacySheet(name, rows));
      return;
    }
    const parsed = parseModernSheet(name, rows);
    orders.push(...parsed.orders);
    skippedInternalBlocks += parsed.skippedInternalBlocks;
    skippedInactiveBlocks += parsed.skippedInactiveBlocks;
  });

  if (orders.length === 0) throw new Error("Workbook contains no external order blocks");
  const keys = new Set<string>();
  orders.forEach((order) => {
    const key = `${order.orderDate}:${normalizeBeerOrderValue(order.customerLabel)}`;
    if (keys.has(key)) throw new Error(`Duplicate customer/date order block: ${order.customerLabel} on ${order.orderDate}`);
    keys.add(key);
  });
  return { orders, prices, skippedInternalBlocks, skippedInactiveBlocks };
}
