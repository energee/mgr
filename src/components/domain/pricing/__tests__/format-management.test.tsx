// @vitest-environment jsdom
/**
 * Tests for FormatManagement's channel-format toggle error handling
 * (audit UI-7/SF-8): the channel_formats insert/delete mutation was fired
 * with bare `.mutate()` and no `onError`, so a failed write silently reverted
 * the switch while the operator believed the format was live/hidden for the
 * channel. Pins that the toggle mutation now carries an onError that toasts
 * (direction-specific message) and that flipping a switch feeds the mutation
 * the right variables.
 *
 * Follows the repo's render-test idiom (createRoot + act; no
 * @testing-library/react). `@/lib/supabase/client` is mocked (its real module
 * runs env validation at import time) and `@tanstack/react-query` is mocked so
 * `useQuery` reads from a hoisted fixture and `useMutation` CAPTURES its
 * options — the test invokes the captured `onError` directly, exactly what
 * TanStack calls when the mutationFn rejects.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { act } from "react";
import { setupRenderHarness } from "@/test/react-harness";

const mockToastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { error: mockToastError, success: vi.fn() },
}));

// Hoisted fixtures + mutation-options capture for the react-query mock.
const harness = vi.hoisted(() => ({
  queryData: {} as Record<string, unknown>,
  capturedMutations: [] as Array<Record<string, unknown>>,
  mutate: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/hooks/use-catalog", () => ({ formatVolumeLabel: () => null }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: readonly unknown[] }) => {
    const key = String(options.queryKey[0]);
    return { data: harness.queryData[key], isLoading: false, isPending: false };
  },
  useMutation: (options: Record<string, unknown>) => {
    harness.capturedMutations.push(options);
    return { mutate: harness.mutate, isPending: false };
  },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import { FormatManagement } from "../format-management";

const { render } = setupRenderHarness();

const channel = {
  id: "ch-1",
  name: "Taproom",
  code: "taproom",
  position: 0,
  is_active: true,
};

function renderWithFixtures() {
  // Key names come from settingsKeys.pricingFormatsAll() / channelFormatKeys.all()
  harness.queryData["pricing-formats-all"] = [
    {
      id: "sf-1",
      name: "6-pack",
      container_id: "c-1",
      container_name: "12oz can",
      container_type: "can",
      unit_count: 6,
      volume_oz: 72,
      volume_bbl: null,
    },
  ];
  harness.queryData["channel-formats"] = [];
  return render(
    <FormatManagement
      channels={[channel]}
      activeChannelId={channel.id}
      onChannelChange={vi.fn()}
    />
  );
}

beforeEach(() => {
  mockToastError.mockClear();
  harness.capturedMutations.length = 0;
  harness.mutate.mockClear();
});

describe("FormatManagement toggle mutation", () => {
  it("registers an onError handler that toasts a direction-specific message", () => {
    renderWithFixtures();
    const toggle = harness.capturedMutations[0];
    expect(toggle).toBeDefined();
    expect(typeof toggle.onError).toBe("function");

    const onError = toggle.onError as (
      error: unknown,
      variables: { sellingFormatId: string; salesChannelId: string; enabled: boolean },
      context: unknown
    ) => void;

    onError(new Error("insert failed"), {
      sellingFormatId: "sf-1",
      salesChannelId: "ch-1",
      enabled: true,
    }, undefined);
    expect(mockToastError).toHaveBeenCalledWith(
      "Failed to enable format for channel"
    );

    onError(new Error("delete failed"), {
      sellingFormatId: "sf-1",
      salesChannelId: "ch-1",
      enabled: false,
    }, undefined);
    expect(mockToastError).toHaveBeenCalledWith(
      "Failed to disable format for channel"
    );
  });

  it("flipping a switch fires the mutation with the format/channel variables", () => {
    const container = renderWithFixtures();
    const switchEl = container.querySelector<HTMLButtonElement>(
      'button[role="switch"]'
    );
    expect(switchEl).not.toBeNull();
    act(() => switchEl!.click());
    expect(harness.mutate).toHaveBeenCalledWith({
      sellingFormatId: "sf-1",
      salesChannelId: "ch-1",
      enabled: true,
    });
  });
});
