/**
 * downloadCSV BOM regression test.
 *
 * The TTB caveat rows contain an em dash, and brewery data routinely contains
 * accented beer and customer names. Excel ignores the blob's `charset=utf-8`
 * for a file opened from disk and falls back to the system ANSI codepage, so
 * without a UTF-8 BOM those bytes render as mojibake in the CSV someone
 * attaches to a federal filing. This pins the BOM so a future tidy-up of the
 * `new Blob([...])` call cannot silently drop it.
 *
 * Needs a DOM: `src/lib/**` otherwise runs in the `node` vitest project.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { downloadCSV } from "@/lib/report-export";

/**
 * The BOM must be asserted on the RAW BYTES, not via `blob.text()`: `text()`
 * performs a UTF-8 decode, and the Encoding spec strips a leading BOM during
 * decode — so `text()` can never observe it even when it is present.
 */
const BOM_BYTES = [0xef, 0xbb, 0xbf];

async function bytesOf(blob: Blob): Promise<number[]> {
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

/** Capture the Blob downloadCSV hands to URL.createObjectURL. */
function captureDownloadedBlob(csv: string): Blob {
  const blobs: Blob[] = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation((obj: Blob | MediaSource) => {
    blobs.push(obj as Blob);
    return "blob:mock";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

  downloadCSV(csv, "report.csv");

  expect(blobs).toHaveLength(1);
  return blobs[0];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("downloadCSV", () => {
  it("prepends a UTF-8 BOM so Excel decodes non-ASCII correctly", async () => {
    const blob = captureDownloadedBlob("Line Item,Value\nNOTE: in-process — snapshot,0\n");

    expect((await bytesOf(blob)).slice(0, 3)).toEqual(BOM_BYTES);
    // The em dash must survive intact, not be stripped or escaped. text()
    // drops the BOM during decode, which is exactly why it cannot assert it.
    expect(await blob.text()).toContain("in-process — snapshot");
  });

  it("keeps the caller's CSV byte-identical after the BOM", async () => {
    const csv = "a,b\n1,2\n";
    const bytes = await bytesOf(captureDownloadedBlob(csv));

    expect(bytes.slice(0, 3)).toEqual(BOM_BYTES);
    expect(new TextDecoder().decode(new Uint8Array(bytes.slice(3)))).toBe(csv);
  });

  it("declares the UTF-8 CSV media type", () => {
    expect(captureDownloadedBlob("a,b\n").type).toBe("text/csv;charset=utf-8;");
  });
});
