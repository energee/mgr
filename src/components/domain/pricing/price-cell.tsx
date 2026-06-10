"use client";

/**
 * Price Cell
 *
 * Inline-editable price cell for the pricing matrix. Click to edit;
 * Tab/Enter/Arrow keys commit and navigate to adjacent cells via the
 * `onNavigate` callback (cells are located by data-cell-row/col attributes).
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { NavigateDirection } from "@/components/domain/pricing/types";

export function PriceCell({
  price,
  tierId,
  formatId,
  channelId,
  rowIndex,
  colIndex,
  onSave,
  onNavigate,
}: {
  price: number | null;
  tierId: string;
  formatId: string;
  channelId: string;
  rowIndex: number;
  colIndex: number;
  onSave: (tierId: string, formatId: string, channelId: string, value: number | null) => void;
  onNavigate: (rowIndex: number, colIndex: number, direction: NavigateDirection) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const dirtyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const startEditing = useCallback(() => {
    setValue(price != null ? price.toFixed(2) : "");
    dirtyRef.current = false;
    setEditing(true);
  }, [price]);

  useEffect(() => {
    const el = buttonRef.current;
    if (el) {
      el.dataset.cellRow = String(rowIndex);
      el.dataset.cellCol = String(colIndex);
    }
  }, [rowIndex, colIndex]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = useCallback(() => {
    setEditing(false);
    // If the user never typed anything, treat as cancel — prevents accidental
    // deletes when a cell is opened before price data has loaded.
    if (!dirtyRef.current) return;
    const trimmed = value.trim();
    const parsed = trimmed === "" ? null : parseFloat(trimmed);
    if (trimmed !== "" && (isNaN(parsed!) || parsed! < 0)) {
      toast.error("Invalid price");
      return;
    }
    if (parsed !== price) {
      onSave(tierId, formatId, channelId, parsed);
    }
  }, [value, price, tierId, formatId, channelId, onSave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
        onNavigate(rowIndex, colIndex, "down");
      } else if (e.key === "Tab") {
        e.preventDefault();
        commit();
        onNavigate(rowIndex, colIndex, e.shiftKey ? "left" : "right");
      } else if (e.key === "Escape") {
        setEditing(false);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        commit();
        onNavigate(rowIndex, colIndex, "up");
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        commit();
        onNavigate(rowIndex, colIndex, "down");
      } else if (e.key === "ArrowLeft" && inputRef.current?.selectionStart === 0) {
        e.preventDefault();
        commit();
        onNavigate(rowIndex, colIndex, "left");
      } else if (e.key === "ArrowRight" && inputRef.current?.selectionStart === value.length) {
        e.preventDefault();
        commit();
        onNavigate(rowIndex, colIndex, "right");
      }
    },
    [commit, onNavigate, rowIndex, colIndex, value.length]
  );

  if (editing) {
    return (
      <Input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => { dirtyRef.current = true; setValue(e.target.value); }}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        className="h-8 w-full text-right text-sm px-2 py-0 tabular-nums"
      />
    );
  }

  return (
    <button
      ref={buttonRef}
      onClick={startEditing}
      className={cn(
        "w-full h-8 text-right text-sm px-2 rounded transition-colors cursor-text tabular-nums",
        price != null
          ? "hover:bg-muted/50"
          : "text-muted-foreground/30 hover:bg-muted/30"
      )}
    >
      {price != null ? `$${price.toFixed(2)}` : "·"}
    </button>
  );
}
