/**
 * Report Export Utilities
 *
 * Provides CSV and print-friendly export functionality for reports.
 * Used for TTB compliance reports and other data exports.
 */

import {
  formatTtbBbl,
  getTaxClassLabel,
  getTotalScopeCaveat,
  getInProcessBalanceNote,
  getReportExemptionDisclosure,
  totalForColumn,
  totalScopedLineLabel,
  TOTAL_COLUMN_LABEL,
  IN_PROCESS_LABEL,
  type TTBReportRow,
  type TTBVolumeField,
} from "@/domain/ttb-utils";

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
 *
 * A UTF-8 BOM is prepended because Excel ignores the blob's `charset=utf-8`
 * for a file opened from disk and falls back to the system ANSI codepage — so
 * any non-ASCII byte (the em dash in the TTB caveat rows, an accented beer or
 * customer name) renders as mojibake in the copy someone attaches to a filing.
 * The BOM makes Excel decode UTF-8; other CSV readers skip it.
 */
export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8;" });
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

/**
 * A `get_ttb_report` row, as the export functions receive it.
 *
 * Alias rather than a second declaration: this used to be a hand-copied
 * duplicate of `TTBReportRow`, which is exactly how the exported copies of a
 * report drift from the screen's.
 */
export type TTBReportData = TTBReportRow;

export type TTBBatchData = {
  batch_code: string;
  name: string;
  status: string;
  volume_bbl: number | null;
}

/**
 * Build the TTB report CSV text.
 *
 * Split out from `exportTTBReportToCSV` so the content — in particular the
 * trailing NOTE rows — is unit-testable without a DOM or a download.
 *
 * Those NOTE rows are load-bearing, not decoration: a CSV is the copy most
 * likely to be attached to an actual Form 5130.9 filing, so it carries the same
 * in-process balance note, "not accounting-identity checked" disclosure
 * (issue #618) and Total-column scope note (issue #670) the screen and the print
 * view show. They are trailing rows in the "Line Item" column, matching how every
 * other label and section header in this CSV is carried.
 */
export function buildTTBReportCSV(
  reportData: TTBReportData[],
  year: number,
  month: number
): string {
  const monthName = new Date(year, month - 1).toLocaleString("default", { month: "long" });
  const periodLabel = `${monthName} ${year}`;

  // Column headers for each tax class
  const taxClasses = reportData.map((r) => r.ttb_tax_class);

  /** A label-only row: section header or blank spacer, with every value cell empty. */
  const labelRow = (label: string): CSVRow => ({
    "Line Item": label,
    ...Object.fromEntries(taxClasses.map((tc) => [getTaxClassLabel(tc), ""])),
    [TOTAL_COLUMN_LABEL]: "",
  });

  // Create detailed report
  const detailRows: CSVRow[] = [
    labelRow("PART I - OPERATIONS"),
    createDataRow("Beginning Inventory", reportData, "beginning_inventory_bbl"),
    createDataRow("Beer Produced/Packaged", reportData, "beer_produced_bbl"),
    createDataRow("Total Available", reportData, "total_available_bbl"),
    labelRow(""),
    labelRow("PART II - DISPOSITION"),
    createDataRow("Taxpaid (Domestic)", reportData, "taxpaid_domestic_bbl"),
    createDataRow("Taxpaid (Export)", reportData, "taxpaid_export_bbl"),
    createDataRow("Tax-Free Samples", reportData, "tax_free_samples_bbl"),
    createDataRow("Losses", reportData, "losses_bbl"),
    createDataRow("Destroyed", reportData, "destroyed_bbl"),
    createDataRow("Total Removals", reportData, "total_removals_bbl"),
    labelRow(""),
    labelRow("ENDING BALANCE"),
    createDataRow("Ending Inventory", reportData, "ending_inventory_bbl"),
    labelRow(""),
    // In-process volumes are period-end balances reconstructed from the batch
    // audit trail (migration 00287, issue #618).
    labelRow("BEER IN PROCESS (END OF PERIOD)"),
    createDataRow(IN_PROCESS_LABEL, reportData, "in_process_ending_bbl"),
  ];

  // Trailing note rows. Only the "Line Item" key is set: toCSV takes its columns
  // from the first row, so the remaining tax-class/Total cells render empty.
  const exemptionDisclosure = getReportExemptionDisclosure(reportData);
  const totalScopeCaveat = getTotalScopeCaveat(reportData);
  const noteRows: CSVRow[] = [
    { "Line Item": "" },
    { "Line Item": `NOTE: ${getInProcessBalanceNote(periodLabel)}` },
    ...(exemptionDisclosure ? [{ "Line Item": `NOTE: ${exemptionDisclosure}` }] : []),
    ...(totalScopeCaveat ? [{ "Line Item": `NOTE: ${totalScopeCaveat}` }] : []),
  ];

  return toCSV([...detailRows, ...noteRows]);
}

/**
 * Export TTB report data to CSV (builds the text, then downloads it).
 */
export function exportTTBReportToCSV(
  reportData: TTBReportData[],
  year: number,
  month: number
): void {
  const csv = buildTTBReportCSV(reportData, year, month);
  downloadCSV(csv, `ttb-report-${year}-${String(month).padStart(2, "0")}.csv`);
}

/**
 * One data line of the CSV: the per-tax-class cells plus the Total cell.
 *
 * The Total comes from `totalForColumn`, the same helper the screen's
 * `calculateTotals` and the print view use — it must not be re-derived here, or
 * the exported copy silently disagrees with the screen about what the Total
 * covers (issues #618, #670). The label is marked by `totalScopedLineLabel`
 * when this line's Total is packaged-only, matching the screen and the print
 * view.
 */
function createDataRow(
  label: string,
  reportData: TTBReportData[],
  field: TTBVolumeField
): CSVRow {
  const row: CSVRow = { "Line Item": totalScopedLineLabel(reportData, label, field) };

  reportData.forEach((r) => {
    row[getTaxClassLabel(r.ttb_tax_class)] = formatTtbBbl(r[field] || 0);
  });

  row[TOTAL_COLUMN_LABEL] = formatTtbBbl(totalForColumn(reportData, field));
  return row;
}

// getTaxClassLabel imported from @/domain/ttb-utils

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
    "Volume (BBL)": formatTtbBbl(b.volume_bbl || 0),
  }));

  // Add total row
  const total = batches.reduce((sum, b) => sum + (b.volume_bbl || 0), 0);
  rows.push({
    "Batch Code": "TOTAL",
    Name: "",
    Status: "",
    "Volume (BBL)": formatTtbBbl(total),
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
  year: number,
  month: number,
  breweryName?: string
): string {
  const monthName = new Date(year, month - 1).toLocaleString("default", { month: "long" });
  const taxClasses = reportData.map((r) => r.ttb_tax_class);
  // Same in-process balance note and "not checked" disclosure the screen and
  // the CSV carry — a printed copy must not be more confident than the screen
  // (#618).
  const exemptionDisclosure = getReportExemptionDisclosure(reportData);
  const totalScopeCaveat = getTotalScopeCaveat(reportData);

  const tableHeaderCells = taxClasses
    .map((tc) => `<th style="text-align: right; padding: 8px; border: 1px solid #ccc;">${getTaxClassLabel(tc)}</th>`)
    .join("");

  // The Total cell comes from `totalForColumn` and the label marker from
  // `totalScopedLineLabel` — the same helpers the screen and the CSV use, so the
  // printed Total cannot mean something else (#670).
  function createRow(label: string, field: TTBVolumeField, indent = false): string {
    const cells = reportData
      .map((r) => `<td style="text-align: right; padding: 8px; border: 1px solid #ccc; font-family: monospace;">${formatTtbBbl(r[field] || 0)}</td>`)
      .join("");
    const total = totalForColumn(reportData, field);
    const labelStyle = indent ? "padding-left: 24px;" : "font-weight: bold;";
    return `<tr>
      <td style="${labelStyle} padding: 8px; border: 1px solid #ccc;">${totalScopedLineLabel(reportData, label, field)}</td>
      ${cells}
      <td style="text-align: right; padding: 8px; border: 1px solid #ccc; font-family: monospace; font-weight: bold;">${formatTtbBbl(total)}</td>
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
        <th style="text-align: right; padding: 8px; border: 1px solid #ccc;">${TOTAL_COLUMN_LABEL}</th>
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

      ${createSectionHeader("Beer in Process (Cellar) — end of period")}
      ${createRow(IN_PROCESS_LABEL, "in_process_ending_bbl")}
    </tbody>
  </table>

  <p style="margin-top: 30px; font-size: 10px; color: #666;">
    <strong>Note:</strong> This report is prepared for internal use and TTB Form 5130.9 filing reference.
    One barrel (BBL) equals 31 gallons per TTB regulations. Verify all data before submission.
  </p>

  <p style="font-size: 10px; color: #666;">
    <strong>Cellar/In-Process:</strong> ${escapeHTML(getInProcessBalanceNote(`${monthName} ${year}`))}
  </p>

  ${
    totalScopeCaveat
      ? `<p style="font-size: 10px; color: #666;">${escapeHTML(totalScopeCaveat)}</p>`
      : ""
  }

  ${
    exemptionDisclosure
      ? `<p style="font-size: 10px; color: #666;">${escapeHTML(exemptionDisclosure)}</p>`
      : ""
  }

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
  year: number,
  month: number,
  breweryName?: string
): void {
  const html = generateTTBPrintHTML(reportData, year, month, breweryName);
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
