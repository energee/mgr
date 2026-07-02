/**
 * Shared createRoot + act render harness for context/component tests — the
 * repo intentionally has no @testing-library/react (see
 * src/components/domain/recipe/__tests__/mash-schedule-editor.test.tsx for
 * the original idiom this centralizes).
 *
 * Call `setupRenderHarness()` at module scope in a test file. It registers an
 * afterEach that unmounts the root AND removes the container from
 * document.body (per-file copies of this idiom historically leaked containers
 * into the jsdom body across tests), and returns render/rerender/unmount
 * helpers bound to that file's root.
 */
import { afterEach } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

export function setupRenderHarness() {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  const cleanup = () => {
    const r = root;
    root = null;
    if (r) act(() => r.unmount());
    container?.remove();
    container = null;
  };
  afterEach(cleanup);

  return {
    /** Mounts `el` in a fresh container appended to document.body. */
    render(el: ReactElement): HTMLElement {
      cleanup();
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      act(() => root!.render(el));
      return container;
    },
    /** Re-renders into the existing root (state-preserving update). */
    rerender(el: ReactElement) {
      if (!root) throw new Error("rerender() called before render()");
      act(() => root!.render(el));
    },
    /** Unmounts AND removes the container (same as the afterEach cleanup). */
    unmount: cleanup,
  };
}
