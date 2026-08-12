/**
 * Minimal DOM interaction helpers for the createRoot + act render harness
 * (see react-harness.ts — the repo intentionally has no @testing-library/react).
 *
 * `setInputValue` uses the native value setter so React's controlled-input
 * tracking sees the change, then dispatches a bubbling `input` event (what
 * React's root-delegated `onChange` listens for).
 */
import { act } from "react";

export function click(el: Element | null | undefined) {
  if (!el) throw new Error("click() called with no element");
  act(() => {
    (el as HTMLElement).click();
  });
}

export function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
