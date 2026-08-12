// @vitest-environment jsdom
/**
 * Characterization tests for the shared line-items editor primitives.
 *
 * These pin the machinery the four child-row editors (order items, PO line
 * items, transfer lines, packaging session line items) delegate to after the
 * extraction: the buffered parse -> skip-invalid -> skip-unchanged -> write
 * commit rule in `useLineItemEdits`, and the add-row open/close/reset contract
 * in `useAddRow`.
 *
 * Why here and not in the four editor suites: those suites are render-level
 * (spinner, empty state, row layout, footers, readOnly) and none of them types
 * into a cell and blurs, so the commit rule — the actual payload of the
 * extraction — had no executable coverage on any editor. Testing it once at
 * the source covers all four callers instead of repeating an editor-shaped
 * setup four times.
 *
 * Follows the repo's render-test idiom (createRoot + act; no
 * @testing-library/react). Nothing here touches Supabase or react-query — the
 * module is deliberately free of both — so no mocks are needed.
 */

import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { setupRenderHarness } from "@/test/react-harness";
import {
  LineItemEditInput,
  useAddRow,
  useLineItemEdits,
} from "../line-items-editor";

const { render } = setupRenderHarness();

/** Mirrors the integer-quantity validation the transfer editor passes in. */
const parseQuantity = (_field: "quantity", raw: string) => {
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
};

/**
 * Mounts a single `LineItemEditInput` bound to a real `useLineItemEdits`,
 * returning the input plus the recorded `onCommit` calls.
 */
function renderEditInput(savedValue: number | null) {
  const onCommit = vi.fn();
  function Harness() {
    const edits = useLineItemEdits<"quantity">({
      parse: parseQuantity,
      onCommit,
    });
    return (
      <LineItemEditInput
        edits={edits}
        rowId="row-1"
        field="quantity"
        savedValue={savedValue}
      />
    );
  }
  const container = render(<Harness />);
  const input = container.querySelector("input") as HTMLInputElement;
  return { input, onCommit };
}

/** Types `raw` into the input the way React's controlled onChange expects. */
function type(input: HTMLInputElement, raw: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, raw);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

// React's synthetic onBlur is delegated off the native `focusout` event (plain
// `blur` does not bubble, so it never reaches React's root listener).
const blur = (input: HTMLInputElement) =>
  act(() => {
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });

const pressEnter = (input: HTMLInputElement) =>
  act(() => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });

describe("useLineItemEdits commit rule", () => {
  it("shows the saved value until something is typed", () => {
    const { input } = renderEditInput(4);
    expect(input.value).toBe("4");
  });

  it("buffers keystrokes without writing", () => {
    const { input, onCommit } = renderEditInput(4);
    type(input, "7");
    expect(input.value).toBe("7");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits a changed value on blur", () => {
    const { input, onCommit } = renderEditInput(4);
    type(input, "7");
    blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("row-1", "quantity", 7);
  });

  it("commits a changed value on Enter", () => {
    const { input, onCommit } = renderEditInput(4);
    type(input, "9");
    pressEnter(input);
    expect(onCommit).toHaveBeenCalledWith("row-1", "quantity", 9);
  });

  it("skips the write when the typed value parses to the saved value", () => {
    const { input, onCommit } = renderEditInput(4);
    type(input, "4");
    blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("skips the write and reverts when input is invalid", () => {
    const { input, onCommit } = renderEditInput(4);
    type(input, "0"); // below the >= 1 floor
    blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe("4");
  });

  it("reverts to the saved value when the field is cleared", () => {
    const { input, onCommit } = renderEditInput(4);
    type(input, "");
    // A buffered empty string survives until commit — the user can see the
    // field empty while typing.
    expect(input.value).toBe("");
    blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe("4");
  });

  it("does not write again on a second blur with nothing newly typed", () => {
    const { input, onCommit } = renderEditInput(4);
    type(input, "7");
    blur(input);
    blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("renders empty rather than uncontrolled when there is no saved value", () => {
    const { input } = renderEditInput(null);
    expect(input.value).toBe("");
  });
});

describe("useLineItemEdits buffer keying", () => {
  it("keeps per-field and per-row buffers independent", () => {
    // Two fields on one row, plus the same field on a second row: editing any
    // one cell must not disturb the others.
    function Harness() {
      const edits = useLineItemEdits<"quantity" | "unit_price">({
        parse: (_f, raw) => {
          const n = Number(raw);
          return Number.isFinite(n) ? n : null;
        },
        onCommit: vi.fn(),
      });
      return (
        <>
          <LineItemEditInput
            data-testid="r1-qty"
            edits={edits}
            rowId="row-1"
            field="quantity"
            savedValue={1}
          />
          <LineItemEditInput
            data-testid="r1-price"
            edits={edits}
            rowId="row-1"
            field="unit_price"
            savedValue={10}
          />
          <LineItemEditInput
            data-testid="r2-qty"
            edits={edits}
            rowId="row-2"
            field="quantity"
            savedValue={99}
          />
        </>
      );
    }
    const c = render(<Harness />);
    const at = (id: string) =>
      c.querySelector(`[data-testid="${id}"]`) as HTMLInputElement;

    type(at("r1-qty"), "3");

    expect(at("r1-qty").value).toBe("3");
    // Same row, different field — untouched.
    expect(at("r1-price").value).toBe("10");
    // Same field, different row — untouched.
    expect(at("r2-qty").value).toBe("99");
  });
});

/**
 * Renders the add-row state as text plus open/close buttons, so the hook is
 * driven through the DOM rather than by capturing the controller during render
 * (which the react-hooks lint rules disallow).
 */
function renderAddRow(onClose?: () => void) {
  function Harness() {
    const addRow = useAddRow(onClose ? { onClose } : undefined);
    return (
      <>
        <span data-testid="state">{String(addRow.showAddRow)}</span>
        <button data-testid="open" onClick={addRow.open} />
        <button data-testid="close" onClick={addRow.close} />
      </>
    );
  }
  const c = render(<Harness />);
  const click = (id: string) =>
    act(() => {
      (c.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement).click();
    });
  return {
    state: () => c.querySelector('[data-testid="state"]')!.textContent,
    open: () => click("open"),
    close: () => click("close"),
  };
}

describe("useAddRow", () => {
  it("starts closed, opens, and closes", () => {
    const addRow = renderAddRow();
    expect(addRow.state()).toBe("false");
    addRow.open();
    expect(addRow.state()).toBe("true");
    addRow.close();
    expect(addRow.state()).toBe("false");
  });

  it("runs onClose on every close, so a draft reset cannot be missed", () => {
    const onClose = vi.fn();
    const addRow = renderAddRow(onClose);

    addRow.open();
    addRow.close();
    expect(onClose).toHaveBeenCalledTimes(1);

    // Closing again (e.g. Cancel after a programmatic close) resets again.
    addRow.close();
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("does not run onClose on open", () => {
    const onClose = vi.fn();
    const addRow = renderAddRow(onClose);
    addRow.open();
    expect(onClose).not.toHaveBeenCalled();
  });
});
