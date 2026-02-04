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

interface TimePickerProps {
  id?: string
  value?: string // "HH:mm" format
  onChange?: (value: string) => void
  disabled?: boolean
  minuteStep?: number // 1, 5, 15 (default 5)
  className?: string
}

function generateHourOptions(): string[] {
  return Array.from({ length: 24 }, (_, i) =>
    i.toString().padStart(2, "0")
  )
}

function generateMinuteOptions(step: number): string[] {
  const safeStep = Math.max(1, Math.min(30, Math.round(step)))
  const options: string[] = []
  for (let i = 0; i < 60; i += safeStep) {
    options.push(i.toString().padStart(2, "0"))
  }
  return options
}

function TimePicker({
  id,
  value,
  onChange,
  disabled = false,
  minuteStep = 5,
  className,
}: TimePickerProps) {
  const hourOptions = React.useMemo(() => generateHourOptions(), [])
  const minuteOptions = React.useMemo(
    () => generateMinuteOptions(minuteStep),
    [minuteStep]
  )

  const [hour, minute] = React.useMemo(() => {
    if (!value) return ["", ""]
    const parts = value.split(":")
    return [parts[0] ?? "", parts[1] ?? ""]
  }, [value])

  const handleHourChange = React.useCallback(
    (newHour: string) => {
      const newMinute = minute || "00"
      onChange?.(`${newHour}:${newMinute}`)
    },
    [minute, onChange]
  )

  const handleMinuteChange = React.useCallback(
    (newMinute: string) => {
      const newHour = hour || "00"
      onChange?.(`${newHour}:${newMinute}`)
    },
    [hour, onChange]
  )

  return (
    <div id={id} className="flex items-center gap-1">
      <Select
        value={hour || undefined}
        onValueChange={handleHourChange}
        disabled={disabled}
      >
        <SelectTrigger className={cn("w-[4.5rem]", className)}>
          <SelectValue placeholder="HH" />
        </SelectTrigger>
        <SelectContent>
          {hourOptions.map((h) => (
            <SelectItem key={h} value={h}>
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-muted-foreground text-sm">:</span>
      <Select
        value={minute || undefined}
        onValueChange={handleMinuteChange}
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
    </div>
  )
}

export { TimePicker }
export type { TimePickerProps }
