import { useEffect, useRef } from "react";

/**
 * Returns a ref to attach to a submit button. When the user presses
 * Cmd+Enter (Mac) or Ctrl+Enter (other), the referenced button is clicked,
 * triggering normal form submission including validation and loading states.
 *
 * This is intentionally separate from the global useKeyboardShortcuts system
 * because that system suppresses shortcuts while focused on inputs—exactly
 * when Cmd+Enter needs to work.
 */
export function useSubmitShortcut(): React.RefObject<HTMLButtonElement | null> {
  const ref = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        const button = ref.current;
        if (button && !button.disabled) {
          e.preventDefault();
          button.click();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return ref;
}
