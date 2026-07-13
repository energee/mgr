/**
 * RecordCellCountDialog Form-primitive wiring tests (audit A11Y-3).
 *
 * The dialog was migrated from hand-rolled {...form.register()} + bare error
 * <p> blocks onto the shared Form primitives (FormField/FormControl/
 * FormMessage). These tests pin the accessibility contract that migration
 * buys: a validation failure renders a role="alert" message that is
 * referenced by the failing input's aria-describedby, with aria-invalid set.
 *
 * Uses the shared createRoot+act harness (src/test/react-harness.ts) — the
 * repo intentionally has no @testing-library/react. Radix DialogContent
 * portals into document.body, so queries go through document rather than the
 * harness container.
 */

import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupRenderHarness } from "@/test/react-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// ---------------------------------------------------------------------------
// Mocks (before importing the dialog) — the module-level supabase client
// import runs env validation, so it must be mocked.
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { RecordCellCountDialog } from "@/components/domain/yeast/record-cell-count-dialog";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const { render } = setupRenderHarness();

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RecordCellCountDialog
        open
        onOpenChange={() => {}}
        pitchId="pitch-1"
        pitchName="WLP001 (G2)"
      />
    </QueryClientProvider>
  );
}

function inputByPlaceholder(placeholder: string): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    `input[placeholder="${placeholder}"]`
  );
  expect(input, `input with placeholder "${placeholder}" not found`).not.toBeNull();
  return input!;
}

async function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit() {
  // Dispatch the submit event directly (fireEvent.submit semantics): jsdom's
  // requestSubmit/button-click path runs native constraint validation
  // (min/max attributes) and would swallow the submit before React sees it.
  const formEl = document.querySelector("form");
  expect(formEl, "dialog form not found").not.toBeNull();
  await act(async () => {
    formEl!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RecordCellCountDialog form accessibility (audit A11Y-3)", () => {
  it("labels every input via the Form primitives", () => {
    renderDialog();
    for (const placeholder of ["e.g., 200000", "e.g., 95"]) {
      const input = inputByPlaceholder(placeholder);
      expect(input.id, "FormControl did not assign an id").toBeTruthy();
      const label = document.querySelector(`label[for="${input.id}"]`);
      expect(label, `no label points at input ${input.id}`).not.toBeNull();
    }
  });

  it("announces a validation error and associates it with the failing input", async () => {
    renderDialog();
    // Valid cell count so the viability error is isolated.
    await setInputValue(inputByPlaceholder("e.g., 200000"), "200000");
    const viability = inputByPlaceholder("e.g., 95");
    await setInputValue(viability, "150");
    await submit();

    const message = document.querySelector('[data-slot="form-message"]');
    expect(message, "FormMessage not rendered on invalid submit").not.toBeNull();
    expect(message!.getAttribute("role")).toBe("alert");
    expect(message!.textContent).toContain("Viability must be 0-100");

    expect(viability.getAttribute("aria-invalid")).toBe("true");
    expect(message!.id).toBeTruthy();
    expect(viability.getAttribute("aria-describedby") ?? "").toContain(
      message!.id
    );
  });

  it("keeps valid inputs unflagged after an invalid submit", async () => {
    renderDialog();
    const cellCount = inputByPlaceholder("e.g., 200000");
    await setInputValue(cellCount, "200000");
    await setInputValue(inputByPlaceholder("e.g., 95"), "150");
    await submit();

    expect(cellCount.getAttribute("aria-invalid")).toBe("false");
  });
});
