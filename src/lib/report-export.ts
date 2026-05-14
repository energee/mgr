/**
 * Report Export Utilities
 *
 * Provides CSV and print-friendly export functionality for reports.
 * Used for TTB compliance reports and other data exports.
 */

import { formatBbl } from "@/lib/format";
import { getTaxClassLabel } from "@/lib/ttb-utils";

// =============================================================================
// CSV Export
// =============================================================================

type CSVRow = {
  [key: string]: string | number | null | undefined;
}

/**
 * Convert an array of objects to CSV format
 */
export function toCSV(rows: CSVRow[], columns?: { key: string; header: string }[]): string {
  if (rows.length === 0) return "";

  // If columns not specified, use all keys from first row
  const cols = columns || Object.keys(rows[0]).map((key) => ({ key, header: key }));

  // Header row
  const header = cols.map((col) => escapeCSVField(col.header)).join(",");

  // Data rows
  const dataRows = rows.map((row) =>
    cols
      .map((col) => {
        const value = row[col.key];
        if (value === null || value === undefined) return "";
        if (typeof value === "number") return value.toString();
        return escapeCSVField(value.toString());
      })
      .join(",")
  );

  return [header, ...dataRows].join("\n");
}

/**
 * Escape a field for CSV.
 *
 * Wraps in quotes if the value contains comma, double-quote, or newline.
 * Also defends against CSV formula injection (CVE-2014-3524 style): when a
 * field begins with `=`, `+`, `-`, `@`, tab, or carriage return, Excel and
 * Google Sheets treat the cell as a live formula. We prefix such values with
 * a literal tab inside a quoted field so the spreadsheet renders them as
 * plain text instead of executing.
 */
function escapeCSVField(field: string): string {
  const dangerous = /^[=+\-@\t\r]/.test(field);
  const needsQuoting = dangerous || /[,"\n]/.test(field);
  const escaped = field.replace(/"/g, '""');
  const body = dangerous ? `\t${escaped}` : escaped;
  return needsQuoting ? `"${body}"` : body;
}

/**
 * Strip filesystem-reserved characters from a caller-supplied filename so it
 * can safely be used as a `download` attribute on any platform.
 */
function sanitizeFilename(filename: string): string {
  // Reserved on Windows/macOS/Linux: / \ : * ? " < > | and NUL
  return filename.replace(/[/\\:*?"<>|\0]/g, "_");
}

/**
 * Download CSV data as a file.
 *
 * The object URL is revoked asynchronously because Firefox aborts the
 * download if the URL is invalidated synchronously after `link.click()`.
 */
export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);

  link.setAttribute("href", url);
  link.setAttribute("download", sanitizeFilename(filename));
  link.style.visibility = "hidden";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Defer revocation so Firefox finishes initiating the download first.
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

// =============================================================================
// TTB Report Specific Exports
// =============================================================================

export type TTBReportData = {
  report_year: number;
  report_month: number;
  report_period: string;
  ttb_tax_class: string;
  beginning_inventory_bbl: number;
  beer_produced_bbl: number;
  beer_received_bbl: number;
  total_available_bbl: number;
  taxpaid_domestic_bbl: number;
  taxpaid_export_bbl: number;
  tax_free_samples_bbl: number;
  losses_bbl: number;
  destroyed_bbl: number;
  adjustments_bbl: number;
  total_removals_bbl: number;
  ending_inventory_bbl: number;
  in_process_beginning_bbl: number;
  in_process_ending_bbl: number;
}

export type TTBBatchData = {
  batch_code: string;
  name: string;
  status: string;
  volume_bbl: number | null;
}

/**
 * Export TTB report data to CSV
 */
export function exportTTBReportToCSV(
  reportData: TTBReportData[],
  year: number,
  month: number
): void {
  const monthName = new Date(year, month - 1).toLocaleString("default", { month: "long" });

  // Create summary rows
  const rows: CSVRow[] = [];

  // Add header info
  rows.push({ "Line Item": `TTB Form 5130.9 - ${monthName} ${year}`, "": "" });
  rows.push({ "Line Item": "Brewer's Report of Operations", "": "" });
  rows.push({ "Line Item": "", "": "" });

  // Add column headers for each tax class
  const taxClasses = reportData.map((r) => r.ttb_tax_class);

  // Create detailed report
  const detailRows: CSVRow[] = [
    {
      "Line Item": "PART I - OPERATIONS",
      ...Object.fromEntries(taxClasses.map((tc) => [getTaxClassLabel(tc), ""])),
      Total: "",
    },
    createDataRow("Beginning Inventory", reportData, "beginning_inventory_bbl"),
    createDataRow("Beer Produced/Packaged", reportData, "beer_produced_bbl"),
    createDataRow("Total Available", reportData, "total_available_bbl"),
    {
      "Line Item": "",
      ...Object.fromEntries(taxClasses.map((tc) => [getTaxClassLabel(tc), ""])),
      Total: "",
    },
    {
      "Line Item": "PART II - DISPOSITION",
      ...Object.fromEntries(taxClasses.map((tc) => [getTaxClassLabel(tc), ""])),
      Total: "",
    },
    createDataRow("Taxpaid (Domestic)", reportData, "taxpaid_domestic_bbl"),
    createDataRow("Taxpaid (Export)", reportData, "taxpaid_export_bbl"),
    createDataRow("Tax-Free Samples", reportData, "tax_free_samples_bbl"),
    createDataRow("Losses", reportData, "losses_bbl"),
    createDataRow("Destroyed", reportData, "destroyed_bbl"),
    createDataRow("Total Removals", reportData, "total_removals_bbl"),
    {
      "Line Item": "",
      ...Object.fromEntries(taxClasses.map((tc) => [getTaxClassLabel(tc), ""])),
      Total: "",
    },
    {
      "Line Item": "ENDING BALANCE",
      ...Object.fromEntries(taxClasses.map((tc) => [getTaxClassLabel(tc), ""])),
      Total: "",
    },
    createDataRow("Ending Inventory", reportData, "ending_inventory_bbl"),
    {
      "Line Item": "",
      ...Object.fromEntries(taxClasses.map((tc) => [getTaxClassLabel(tc), ""])),
      Total: "",
    },
    {
      "Line Item": "BEER IN PROCESS",
      ...Object.fromEntries(taxClasses.map((tc) => [getTaxClassLabel(tc), ""])),
      Total: "",
    },
    createDataRow("End of Month (In Process)", reportData, "in_process_ending_bbl"),
  ];

  const csv = toCSV(detailRows);
  downloadCSV(csv, `ttb-report-${year}-${String(month).padStart(2, "0")}.csv`);
}

function createDataRow(
  label: string,
  reportData: TTBReportData[],
  field: keyof TTBReportData
): CSVRow {
  const row: CSVRow = { "Line Item": label };
  let total = 0;

  reportData.forEach((r) => {
    const value = r[field] as number || 0;
    row[getTaxClassLabel(r.ttb_tax_class)] = formatBbl(value);
    total += value;
  });

  row["Total"] = formatBbl(total);
  return row;
}

// getTaxClassLabel imported from @/lib/ttb-utils

/**
 * Export batch details to CSV
 */
export function exportBatchDetailsToCSV(
  batches: TTBBatchData[],
  year: number,
  month: number,
  type: "completed" | "in-process"
): void {
  const rows = batches.map((b) => ({
    "Batch Code": b.batch_code,
    Name: b.name,
    Status: b.status,
    "Volume (BBL)": formatBbl(b.volume_bbl || 0),
  }));

  // Add total row
  const total = batches.reduce((sum, b) => sum + (b.volume_bbl || 0), 0);
  rows.push({
    "Batch Code": "TOTAL",
    Name: "",
    Status: "",
    "Volume (BBL)": formatBbl(total),
  });

  const csv = toCSV(rows);
  downloadCSV(csv, `ttb-batches-${type}-${year}-${String(month).padStart(2, "0")}.csv`);
}

// =============================================================================
// Print-Friendly Export
// =============================================================================

/**
 * Escape user-supplied text for safe interpolation into the print-window HTML.
 * Without this, a brewery name containing `<script>` or `<img onerror=...>`
 * would execute inside the new window (same-origin XSS).
 */
function escapeHTML(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Generate print-friendly HTML for TTB report
 */
export function generateTTBPrintHTML(
  reportData: TTBReportData[],
  totals: {
    beginningInventory: number;
    beerProduced: number;
    totalAvailable: number;
    taxpaidDomestic: number;
    taxpaidExport: number;
    taxFreeSamples: number;
    losses: number;
    destroyed: number;
    totalRemovals: number;
    endingInventory: number;
    inProcessEnding: number;
  },
  year: number,
  month: number,
  breweryName?: string
): string {
  const monthName = new Date(year, month - 1).toLocaleString("default", { month: "long" });
  const taxClasses = reportData.map((r) => r.ttb_tax_class);

  const tableHeaderCells = taxClasses
    .map((tc) => `<th style="text-align: right; padding: 8px; border: 1px solid #ccc;">${getTaxClassLabel(tc)}</th>`)
    .join("");

  function createRow(label: string, field: keyof TTBReportData, indent = false): string {
    const cells = reportData
      .map((r) => `<td style="text-align: right; padding: 8px; border: 1px solid #ccc; font-family: monospace;">${formatBbl(r[field] as number || 0)}</td>`)
      .join("");
    const total = reportData.reduce((sum, r) => sum + ((r[field] as number) || 0), 0);
    const labelStyle = indent ? "padding-left: 24px;" : "font-weight: bold;";
    return `<tr>
      <td style="${labelStyle} padding: 8px; border: 1px solid #ccc;">${label}</td>
      ${cells}
      <td style="text-align: right; padding: 8px; border: 1px solid #ccc; font-family: monospace; font-weight: bold;">${formatBbl(total)}</td>
    </tr>`;
  }

  function createSectionHeader(label: string): string {
    const colspan = taxClasses.length + 2;
    return `<tr style="background: #f0f0f0;">
      <td colspan="${colspan}" style="padding: 8px; border: 1px solid #ccc; font-weight: bold;">${label}</td>
    </tr>`;
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <title>TTB Report - ${monthName} ${year}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; font-size: 12px; }
    h1 { font-size: 18px; margin-bottom: 5px; }
    h2 { font-size: 14px; color: #666; margin-top: 0; }
    table { border-collapse: collapse; width: 100%; margin-top: 20px; }
    @media print {
      body { margin: 0; padding: 20px; }
      @page { margin: 0.5in; }
    }
  </style>
</head>
<body>
  <h1>TTB Form 5130.9 - Brewer's Report of Operations</h1>
  <h2>${escapeHTML(breweryName || "Brewery")} - ${monthName} ${year}</h2>

  <table>
    <thead>
      <tr style="background: #333; color: white;">
        <th style="text-align: left; padding: 8px; border: 1px solid #ccc;">Line Item</th>
        ${tableHeaderCells}
        <th style="text-align: right; padding: 8px; border: 1px solid #ccc;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${createSectionHeader("Part I - Operations in Producing Beer")}
      ${createRow("Beginning Inventory", "beginning_inventory_bbl")}
      ${createRow("Beer Produced/Packaged", "beer_produced_bbl")}
      ${createRow("Total Available", "total_available_bbl")}

      ${createSectionHeader("Part II - Disposition of Beer")}
      ${createRow("Taxpaid (Domestic)", "taxpaid_domestic_bbl", true)}
      ${createRow("Taxpaid (Export)", "taxpaid_export_bbl", true)}
      ${createRow("Tax-Free Samples", "tax_free_samples_bbl", true)}
      ${createRow("Losses", "losses_bbl", true)}
      ${createRow("Destroyed", "destroyed_bbl", true)}
      ${createRow("Total Removals", "total_removals_bbl")}

      ${createSectionHeader("Ending Balance")}
      ${createRow("Ending Inventory", "ending_inventory_bbl")}

      ${createSectionHeader("Beer in Process (Cellar)")}
      ${createRow("End of Month (In Process)", "in_process_ending_bbl")}
    </tbody>
  </table>

  <p style="margin-top: 30px; font-size: 10px; color: #666;">
    <strong>Note:</strong> This report is prepared for internal use and TTB Form 5130.9 filing reference.
    One barrel (BBL) equals 31 gallons per TTB regulations. Verify all data before submission.
  </p>

  <p style="font-size: 10px; color: #666;">
    Generated: ${new Date().toLocaleString()}
  </p>
</body>
</html>
  `;
}

/**
 * Open TTB report in a new window for printing/PDF export
 */
export function openTTBPrintView(
  reportData: TTBReportData[],
  totals: {
    beginningInventory: number;
    beerProduced: number;
    totalAvailable: number;
    taxpaidDomestic: number;
    taxpaidExport: number;
    taxFreeSamples: number;
    losses: number;
    destroyed: number;
    totalRemovals: number;
    endingInventory: number;
    inProcessEnding: number;
  },
  year: number,
  month: number,
  breweryName?: string
): void {
  const html = generateTTBPrintHTML(reportData, totals, year, month, breweryName);
  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    // Close the print window after the user prints or cancels so repeated
    // export clicks do not leave orphaned popups around.
    printWindow.onafterprint = () => printWindow.close();
    // Trigger print dialog after a short delay
    setTimeout(() => {
      printWindow.print();
    }, 250);
  }
}
