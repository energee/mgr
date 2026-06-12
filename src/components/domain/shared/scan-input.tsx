"use client";

/**
 * ScanInput — keyboard-wedge barcode scan field.
 *
 * USB/Bluetooth barcode scanners emulate a keyboard: they "type" the decoded
 * code followed by Enter. This input captures that flow — on Enter it emits
 * the trimmed code via `onScan`, clears itself, and keeps focus so the next
 * scan lands without any tapping. It works identically for manual entry
 * (type a lot number, press Enter), so there is no scanner-detection logic.
 *
 * Match resolution lives with the consumer (see shared/scan-match.ts):
 * the pick list marks the matching line picked; the PO accept-into-inventory
 * dialog selects the matching received rows.
 */

import { useRef } from "react";
import { Input } from "@/components/ui/input";
import { ScanBarcode } from "lucide-react";
import { cn } from "@/lib/utils";

type ScanInputProps = {
  /** Called with the trimmed scanned/typed code on Enter (never empty). */
  onScan: (code: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
};

export function ScanInput({
  onScan,
  placeholder = "Scan barcode…",
  ariaLabel = "Scan barcode",
  className,
}: ScanInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={cn("relative", className)}>
      <ScanBarcode
        className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        ref={inputRef}
        type="text"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="go"
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="h-11 pl-9"
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          // Don't let Enter submit any surrounding form/dialog
          e.preventDefault();
          const value = e.currentTarget.value.trim();
          e.currentTarget.value = "";
          if (value) onScan(value);
          // Keep focus — wedge scanners fire scans back-to-back
          inputRef.current?.focus();
        }}
      />
    </div>
  );
}
