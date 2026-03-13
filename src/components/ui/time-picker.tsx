"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type TimePickerProps = {
  id?: string
  value?: string // "HH:mm" 24hr format (stored value)
  onChange?: (value: string) => void
  disabled?: boolean
  minuteStep?: number // 1, 5, 15 (default 5)
  className?: string
}

const HOUR_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1)

function generateMinuteOptions(step: number): string[] {
  const safeStep = Math.max(1, Math.min(30, Math.round(step)))
  const options: string[] = []
  for (let i = 0; i < 60; i += safeStep) {
    options.push(i.toString().padStart(2, "0"))
  }
  return options
}

/** Convert 24hr hour to { hour12, period } */
function to12(h24: number): { hour12: number; period: "AM" | "PM" } {
  const period: "AM" | "PM" = h24 >= 12 ? "PM" : "AM"
  const hour12 = h24 % 12 || 12
  return { hour12, period }
}

/** Convert 12hr hour + period back to 24hr hour */
function to24(h12: number, period: "AM" | "PM"): number {
  if (period === "AM") return h12 === 12 ? 0 : h12
  return h12 === 12 ? 12 : h12 + 12
}

function TimePicker({
  id,
  value,
  onChange,
  disabled = false,
  minuteStep = 5,
  className,
}: TimePickerProps) {
  const minuteOptions = React.useMemo(
    () => generateMinuteOptions(minuteStep),
    [minuteStep]
  )

  const { hour12, minute, period } = React.useMemo(() => {
    if (!value) return { hour12: 12, minute: "00", period: "AM" as const }
    const parts = value.split(":")
    const h24 = parseInt(parts[0] ?? "0", 10)
    const { hour12: h, period: p } = to12(h24)
    return { hour12: h, minute: parts[1] ?? "00", period: p }
  }, [value])

  const emit = React.useCallback(
    (h12: number, m: string, p: "AM" | "PM") => {
      const h24 = to24(h12, p)
      onChange?.(`${h24.toString().padStart(2, "0")}:${m}`)
    },
    [onChange]
  )

  return (
    <div id={id} className="flex items-center gap-1">
      {/* Hour (1-12) */}
      <Select
        value={hour12.toString()}
        onValueChange={(v) => emit(parseInt(v, 10), minute, period)}
        disabled={disabled}
      >
        <SelectTrigger className={cn("w-[4.5rem]", className)}>
          <SelectValue placeholder="Hr" />
        </SelectTrigger>
        <SelectContent>
          {HOUR_OPTIONS.map((h) => (
            <SelectItem key={h} value={h.toString()}>
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="text-muted-foreground text-sm">:</span>

      {/* Minute */}
      <Select
        value={minute || undefined}
        onValueChange={(m) => emit(hour12, m, period)}
        disabled={disabled}
      >
        <SelectTrigger className={cn("w-[4.5rem]", className)}>
          <SelectValue placeholder="mm" />
        </SelectTrigger>
        <SelectContent>
          {minuteOptions.map((m) => (
            <SelectItem key={m} value={m}>
              {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* AM/PM */}
      <Select
        value={period}
        onValueChange={(p) => emit(hour12, minute, p as "AM" | "PM")}
        disabled={disabled}
      >
        <SelectTrigger className={cn("w-[4.5rem]", className)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="AM">AM</SelectItem>
          <SelectItem value="PM">PM</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

export { TimePicker }
export type { TimePickerProps }
