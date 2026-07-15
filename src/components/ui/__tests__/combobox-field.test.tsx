/**
 * ComboboxField display-on-mount test.
 *
 * Dice UI only resolves a selected value's label from registered option items,
 * which register when the list first opens — so a raw combobox shows a blank
 * input for a preselected value until opened. ComboboxField fixes this by
 * controlling the input text from `selectedLabel`. This guards that: the input
 * must show the label on mount (without opening the list) and resync when the
 * resolved label arrives asynchronously.
 */

import { describe, it, expect } from "vitest";
import { ComboboxField, ComboboxItem } from "@/components/ui/combobox";
import { setupRenderHarness } from "@/test/react-harness";

const harness = setupRenderHarness();

function input(container: HTMLElement) {
  return container.querySelector<HTMLInputElement>(
    'input[data-slot="combobox-input"]',
  );
}

describe("ComboboxField", () => {
  it("shows the selected label on mount without opening the list", () => {
    const c = harness.render(
      <ComboboxField
        value="fmt-1"
        selectedLabel="16oz Can"
        onValueChange={() => {}}
        placeholder="Select format"
      >
        <ComboboxItem value="fmt-1" label="16oz Can">
          16oz Can
        </ComboboxItem>
        <ComboboxItem value="fmt-2" label="Case">
          Case
        </ComboboxItem>
      </ComboboxField>,
    );

    expect(input(c)?.value).toBe("16oz Can");
  });

  it("resyncs the display when the resolved label arrives later", () => {
    // First render before the async catalog resolves the label.
    const el = (label: string) => (
      <ComboboxField
        value="fmt-1"
        selectedLabel={label}
        onValueChange={() => {}}
        placeholder="Select format"
      >
        <ComboboxItem value="fmt-1" label="16oz Can">
          16oz Can
        </ComboboxItem>
      </ComboboxField>
    );

    const c = harness.render(el(""));
    expect(input(c)?.value).toBe("");

    harness.rerender(el("16oz Can"));
    expect(input(c)?.value).toBe("16oz Can");
  });
});
