"use client";

/**
 * Shared date-entry widgets used by every entity `type: "date"` /
 * `type: "datetime"` field (via src/components/universal/field-input.tsx).
 *
 * UX affordances (audit finding C5):
 * - Typed entry: a text input inside the popover parses flexible formats
 *   ("6/15", "2027-08-01", "jun 15") via date-fns and commits on Enter.
 * - Month/year dropdowns: the calendar uses captionLayout="dropdown" so
 *   far-future dates (e.g. lot expirations) are one interaction away.
 * - Today / Clear footer buttons for one-click common actions.
 */

import * as React from "react";
import { format, isValid, parse } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TimePicker } from "@/components/ui/time-picker";

/**
 * Formats accepted by the typed-entry input, tried in order. Yearless
 * formats ("6/15", "Jun 15") resolve against the reference date's year.
 * Full-month formats precede abbreviated ones so "june 15" is not
 * half-consumed by the "MMM" token.
 */
const TYPED_DATE_FORMATS = [
  "yyyy-MM-dd",
  "M/d/yyyy",
  "M/d/yy",
  "M-d-yyyy",
  "M/d",
  "M-d",
  "MMMM d, yyyy",
  "MMMM d yyyy",
  "MMMM d",
  "MMM d, yyyy",
  "MMM d yyyy",
  "MMM d",
  "d MMMM yyyy",
  "d MMM yyyy",
  "d MMMM",
  "d MMM",
] as const;

/** Reject obvious typos like "6/15/203" while allowing wide planning ranges. */
const MIN_TYPED_YEAR = 1900;
const MAX_TYPED_YEAR = 2200;

/**
 * Parses free-form typed date text ("6/15", "2027-08-01", "jun 15") into a
 * Date. Returns undefined when nothing parses or the year is implausible.
 * Exported for unit tests.
 */
export function parseDateInput(
  text: string,
  referenceDate: Date = new Date()
): Date | undefined {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) return undefined;
  for (const fmt of TYPED_DATE_FORMATS) {
    const parsed = parse(normalized, fmt, referenceDate);
    if (
      isValid(parsed) &&
      parsed.getFullYear() >= MIN_TYPED_YEAR &&
      parsed.getFullYear() <= MAX_TYPED_YEAR
    ) {
      return parsed;
    }
  }
  return undefined;
}

type DatePickerPanelProps = {
  /** Currently committed date (seeds the calendar month and typed input). */
  selected: Date | undefined;
  /** Commit a concrete date; the parent closes the popover. */
  onCommit: (date: Date) => void;
  /** Clear the value (optional dates); the parent closes the popover. */
  onClear: () => void;
};

/**
 * Popover body shared by DatePicker and DateTimePicker: typed-entry input,
 * dropdown-caption calendar, and a Today/Clear footer.
 */
function DatePickerPanel({ selected, onCommit, onClear }: DatePickerPanelProps) {
  const [month, setMonth] = React.useState<Date>(selected ?? new Date());
  const [text, setText] = React.useState(
    selected ? format(selected, "MM/dd/yyyy") : ""
  );
  const [invalid, setInvalid] = React.useState(false);

  // Focus the typed-entry input when the popover opens (the panel mounts per
  // open). Keyboard-first entry is the point of this input; Radix moves focus
  // into the popover regardless, this just makes the target deterministic.
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Dropdown year range: a decade either side of today, stretched to include
  // an out-of-range selected value (react-day-picker's default dropdown range
  // ends at the current year, which would hide future expiration dates).
  const currentYear = new Date().getFullYear();
  const minYear = Math.min(currentYear - 10, selected?.getFullYear() ?? currentYear);
  const maxYear = Math.max(currentYear + 10, selected?.getFullYear() ?? currentYear);

  const handleTextChange = (next: string) => {
    setText(next);
    setInvalid(false);
    // Live-preview: navigate the calendar to the typed month once it parses.
    const parsed = parseDateInput(next);
    if (parsed) setMonth(parsed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (!text.trim()) {
      onClear();
      return;
    }
    const parsed = parseDateInput(text);
    if (parsed) onCommit(parsed);
    else setInvalid(true);
  };

  return (
    <div className="flex flex-col">
      <div className="border-b p-2">
        <Input
          ref={inputRef}
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`e.g. 6/15, Jun 15 or ${format(new Date(), "yyyy-MM-dd")}`}
          aria-label="Type a date"
          aria-invalid={invalid || undefined}
        />
        {invalid && (
          <p role="alert" className="text-destructive mt-1 text-xs">
            Unrecognized date — try 6/15, Jun 15 or 2026-06-15
          </p>
        )}
      </div>
      <Calendar
        mode="single"
        captionLayout="dropdown"
        startMonth={new Date(minYear, 0)}
        endMonth={new Date(maxYear, 11)}
        month={month}
        onMonthChange={setMonth}
        selected={selected}
        onSelect={(d) => (d ? onCommit(d) : onClear())}
      />
      <div className="flex items-center justify-between border-t p-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => onCommit(new Date())}>
          Today
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
      </div>
    </div>
  );
}

type DatePickerProps = {
  id?: string;
  value?: string; // ISO date string (YYYY-MM-DD)
  onChange?: (value: string | undefined) => void;
  disabled?: boolean;
  placeholder?: string;
} & React.AriaAttributes; // aria-* (invalid/describedby/required) forwarded to the trigger

export function DatePicker({
  id,
  value,
  onChange,
  disabled,
  placeholder = "Pick a date",
  ...aria
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);

  // Parse ISO string to Date object
  const date = value ? parse(value, "yyyy-MM-dd", new Date()) : undefined;

  const commit = (selectedDate: Date | undefined) => {
    onChange?.(selectedDate ? format(selectedDate, "yyyy-MM-dd") : undefined);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal",
            !date && "text-muted-foreground"
          )}
          {...aria}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date ? format(date, "PPP") : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <DatePickerPanel
          selected={date}
          onCommit={commit}
          onClear={() => commit(undefined)}
        />
      </PopoverContent>
    </Popover>
  );
}

type DateTimePickerProps = {
  id?: string;
  value?: string; // ISO datetime string
  onChange?: (value: string | undefined) => void;
  disabled?: boolean;
  placeholder?: string;
} & React.AriaAttributes; // aria-* (invalid/describedby/required) forwarded to the trigger

export function DateTimePicker({
  id,
  value,
  onChange,
  disabled,
  placeholder = "Pick date and time",
  ...aria
}: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false);

  // Parse value - handle both ISO and datetime-local formats
  const parseValue = (val: string | undefined) => {
    if (!val) return { date: undefined, time: "12:00" };
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return { date: undefined, time: "12:00" };
      return {
        date: d,
        time: format(d, "HH:mm"),
      };
    } catch {
      return { date: undefined, time: "12:00" };
    }
  };

  const { date, time } = parseValue(value);

  // Commit a date (from calendar click, typed entry, or Today), keeping the
  // current time-of-day; undefined clears the whole value.
  const commitDate = (selectedDate: Date | undefined) => {
    if (selectedDate) {
      const [hours, minutes] = time.split(":").map(Number);
      const next = new Date(selectedDate);
      next.setHours(hours, minutes, 0, 0);
      onChange?.(next.toISOString());
    } else {
      onChange?.(undefined);
    }
    setOpen(false);
  };

  const handleTimeChange = (newTime: string) => {
    if (date) {
      const [hours, minutes] = newTime.split(":").map(Number);
      const newDate = new Date(date);
      newDate.setHours(hours, minutes);
      onChange?.(newDate.toISOString());
    }
  };

  return (
    <div className="flex gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            disabled={disabled}
            className={cn(
              "flex-1 justify-start text-left font-normal",
              !date && "text-muted-foreground"
            )}
            {...aria}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date ? format(date, "PPP") : <span>{placeholder}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <DatePickerPanel
            selected={date}
            onCommit={commitDate}
            onClear={() => commitDate(undefined)}
          />
        </PopoverContent>
      </Popover>
      <TimePicker
        value={time}
        onChange={handleTimeChange}
        disabled={disabled || !date}
      />
    </div>
  );
}
