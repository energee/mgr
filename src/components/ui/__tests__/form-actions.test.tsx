/**
 * FormActions tests (audit F-077):
 * - default render: outline cancel (type="button") + default submit
 *   (type="submit" when no onSubmit handler is passed)
 * - onSubmit handler switches submit to type="button" and receives clicks
 * - isLoading disables submit, sets aria-busy, and swaps the label for the
 *   spinner + loading label (defaulting to `${submitLabel}…`)
 * - cancel stays clickable while loading unless cancelDisabled is passed
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

import { FormActions } from "@/components/ui/form-actions";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(ui: React.ReactElement) {
  act(() => root.render(ui));
}

function buttons(): [HTMLButtonElement, HTMLButtonElement] {
  const all = container.querySelectorAll("button");
  expect(all).toHaveLength(2);
  return [all[0] as HTMLButtonElement, all[1] as HTMLButtonElement];
}

describe("FormActions", () => {
  it("renders cancel + submit with default labels and types", () => {
    render(<FormActions onCancel={() => {}} />);
    const [cancel, submit] = buttons();
    expect(cancel.textContent).toBe("Cancel");
    expect(cancel.type).toBe("button");
    expect(submit.textContent).toBe("Save");
    // No onSubmit handler → the surrounding <form> handles submission.
    expect(submit.type).toBe("submit");
    expect(submit.disabled).toBe(false);
  });

  it("uses custom labels and calls onCancel / onSubmit on click", () => {
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    render(
      <FormActions
        submitLabel="Clone Recipe"
        cancelLabel="Skip"
        onCancel={onCancel}
        onSubmit={onSubmit}
      />
    );
    const [cancel, submit] = buttons();
    expect(cancel.textContent).toBe("Skip");
    expect(submit.textContent).toBe("Clone Recipe");
    // Explicit handler → plain button, not a form submit.
    expect(submit.type).toBe("button");
    act(() => cancel.click());
    act(() => submit.click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("shows spinner + loading label and disables submit while loading", () => {
    render(
      <FormActions
        submitLabel="Transfer"
        loadingLabel="Transferring..."
        isLoading
        onCancel={() => {}}
      />
    );
    const [cancel, submit] = buttons();
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute("aria-busy")).toBe("true");
    expect(submit.textContent).toBe("Transferring...");
    expect(submit.querySelector(".animate-spin")).not.toBeNull();
    // Cancel stays clickable during the mutation by default.
    expect(cancel.disabled).toBe(false);
  });

  it("falls back to an ellipsized submit label while loading", () => {
    render(<FormActions submitLabel="Record" isLoading onCancel={() => {}} />);
    const [, submit] = buttons();
    expect(submit.textContent).toBe("Record…");
  });

  it("disables submit via submitDisabled and cancel via cancelDisabled", () => {
    render(
      <FormActions
        submitDisabled
        cancelDisabled
        onCancel={() => {}}
      />
    );
    const [cancel, submit] = buttons();
    expect(submit.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
    expect(submit.getAttribute("aria-busy")).toBe("false");
  });

  it("renders the submit icon only when not loading", () => {
    const icon = <span data-testid="submit-icon" />;
    render(<FormActions submitIcon={icon} onCancel={() => {}} />);
    expect(
      container.querySelector('[data-testid="submit-icon"]')
    ).not.toBeNull();

    render(<FormActions submitIcon={icon} isLoading onCancel={() => {}} />);
    expect(container.querySelector('[data-testid="submit-icon"]')).toBeNull();
  });
});
