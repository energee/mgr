"use client";

/**
 * useNumericInput — raw-string editing state for controlled numeric inputs.
 *
 * Controlled inputs that render `String(value)` or a formatted number fight
 * the keyboard: typing "-" commits NaN (which then renders literally),
 * "1." gets snapped to "1", and "7.753" gets reformatted to "7.75" mid-key-
 * stroke when the display formatter rounds. This hook holds the text the
 * user is typing in local state so re-renders never reformat or clobber
 * in-progress entries, while keeping the form value canonical:
 *
 * - Every keystroke is parsed; `onCommit` receives a finite number or null
 *   (never NaN). In-progress strings like "-", ".", "1e" stay visible in the
 *   input but commit null.
 * - The visible text is resynced from `formattedValue` only when the input
 *   is NOT focused (on blur, or an external change such as form.reset), so
 *   formatting/rounding is applied at rest, never per keystroke.
 * - When `resyncKey` changes (e.g. a display-unit switch that changes the
 *   displayed magnitude), the text is resynced even while focused.
 *
 * Used by UnitInput (src/components/ui/unit-input.tsx) and FieldInput's
 * number case (src/components/universal/field-input.tsx).
 */

import * as React from "react";

/**
 * Parse user-typed text into a number for committing.
 * Returns null for empty or in-progress/invalid strings ("-", ".", "1e",
 * "abc") and never returns NaN/Infinity. Uses strict `Number` semantics, so
 * trailing garbage ("5x") is rejected rather than silently truncated.
 */
export function parseEditableNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

type UseNumericInputOptions = {
  /**
   * Display-formatted committed value ("" when empty). Applied to the
   * visible text only at resync points — never while the user is typing.
   */
  formattedValue: string;
  /** Receives a finite number, or null for empty/in-progress text. */
  onCommit: (value: number | null) => void;
  /**
   * When this changes (Object.is), resync the text even while focused.
   * Pass the display unit so a unit switch updates the visible magnitude.
   */
  resyncKey?: unknown;
};

export function useNumericInput({
  formattedValue,
  onCommit,
  resyncKey,
}: UseNumericInputOptions) {
  const [text, setText] = React.useState(formattedValue);
  const focusedRef = React.useRef(false);
  const lastResyncKeyRef = React.useRef(resyncKey);

  // Resync from the committed value on external changes while unfocused
  // (form.reset, record load), or unconditionally when resyncKey changes.
  React.useEffect(() => {
    const keyChanged = !Object.is(lastResyncKeyRef.current, resyncKey);
    lastResyncKeyRef.current = resyncKey;
    if (keyChanged || !focusedRef.current) {
      setText(formattedValue);
    }
  }, [formattedValue, resyncKey]);

  const handleTextChange = (raw: string) => {
    setText(raw);
    onCommit(parseEditableNumber(raw));
  };

  const handleFocus = () => {
    focusedRef.current = true;
  };

  const handleBlur = () => {
    focusedRef.current = false;
    // Snap the visible text back to the canonical formatted value at rest.
    setText(formattedValue);
  };

  return { text, handleTextChange, handleFocus, handleBlur };
}
