/** Client wiring regression for the dedicated user status command. */

import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupRenderHarness } from "@/test/react-harness";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { useUserAccountStatusCommand } from "../use-user-account-status-command";

function Harness({ action }: { action: "deactivate" | "reactivate" }) {
  const { handleUserStatusAction } = useUserAccountStatusCommand();
  return (
    <button
      type="button"
      onClick={() => handleUserStatusAction(action, { id: "target-1" })}
    >
      Run
    </button>
  );
}

const { render } = setupRenderHarness();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ data: { ok: true } }),
  });
});

describe("useUserAccountStatusCommand", () => {
  it.each(["deactivate", "reactivate"] as const)(
    "sends %s through the server command",
    async (action) => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      const container = render(
        <QueryClientProvider client={queryClient}>
          <Harness action={action} />
        </QueryClientProvider>,
      );

      await act(async () => {
        (container.querySelector("button") as HTMLButtonElement).click();
        await Promise.resolve();
      });

      expect(fetchMock).toHaveBeenCalledWith("/api/users/target-1/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: action }),
      });
    },
  );
});
