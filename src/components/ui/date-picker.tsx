"use client";

import * as React from "react";
import { format, parse } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TimePicker } from "@/components/ui/time-picker";

type DatePickerProps = {
  id?: string;
  value?: string; // ISO date string (YYYY-MM-DD)
  onChange?: (value: string | undefined) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function DatePicker({
  id,
  value,
  onChange,
  disabled,
  placeholder = "Pick a date",
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);

  // Parse ISO string to Date object
  const date = value ? parse(value, "yyyy-MM-dd", new Date()) : undefined;

  const handleSelect = (selectedDate: Date | undefined) => {
    if (selectedDate) {
      onChange?.(format(selectedDate, "yyyy-MM-dd"));
    } else {
      onChange?.(undefined);
    }
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
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date ? format(date, "PPP") : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={handleSelect}
          initialFocus
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
}

export function DateTimePicker({
  id,
  value,
  onChange,
  disabled,
  placeholder = "Pick date and time",
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

  const handleDateSelect = (selectedDate: Date | undefined) => {
    if (selectedDate) {
      const [hours, minutes] = time.split(":").map(Number);
      selectedDate.setHours(hours, minutes);
      onChange?.(selectedDate.toISOString());
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
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date ? format(date, "PPP") : <span>{placeholder}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={handleDateSelect}
            initialFocus
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
