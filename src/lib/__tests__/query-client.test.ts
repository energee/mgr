/**
 * Tests for the app QueryClient's global MutationCache onError fallback
 * (query-client.ts, audit UI-7/SF-8): a mutation WITHOUT its own onError must
 * surface a fallback error toast, while mutations with their own onError (or
 * the `meta.suppressGlobalErrorToast` opt-out for mutateAsync-try/catch call
 * sites) are left to their specific handling.
 *
 * Mutations are executed directly via the MutationCache (build + execute) —
 * no React tree needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockToastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { error: mockToastError },
}));

import { createAppQueryClient } from "@/lib/query-client";

async function runFailingMutation(
  options: Partial<{
    onError: () => void;
    meta: Record<string, unknown>;
  }>,
  error: unknown = new Error("boom")
) {
  const client = createAppQueryClient();
  const mutation = client.getMutationCache().build(client, {
    mutationFn: async () => {
      throw error;
    },
    ...options,
  });
  await expect(mutation.execute(undefined)).rejects.toBe(error);
}

beforeEach(() => {
  mockToastError.mockClear();
});

describe("createAppQueryClient — global mutation error fallback", () => {
  it("toasts the error message when a mutation has no onError of its own", async () => {
    await runFailingMutation({});
    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith("boom");
  });

  it("parses Postgres-shaped errors into friendly messages", async () => {
    // 42501 = insufficient_privilege → the RLS/permission message from errors.ts
    await runFailingMutation(
      {},
      { code: "42501", message: "permission denied for table things" }
    );
    expect(mockToastError).toHaveBeenCalledWith(
      "You don't have permission to perform this action"
    );
  });

  it("falls back to a generic message for message-less failures", async () => {
    await runFailingMutation({}, "not-an-error");
    expect(mockToastError).toHaveBeenCalledWith("An unexpected error occurred");
  });

  it("stays silent when the mutation defines its own onError", async () => {
    const onError = vi.fn();
    await runFailingMutation({ onError });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("stays silent when the mutation opts out via meta.suppressGlobalErrorToast", async () => {
    await runFailingMutation({ meta: { suppressGlobalErrorToast: true } });
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("keeps mutation retries disabled so failures surface immediately", async () => {
    const mutationFn = vi.fn(async () => {
      throw new Error("boom");
    });
    const client = createAppQueryClient();
    const mutation = client.getMutationCache().build(client, { mutationFn });
    await expect(mutation.execute(undefined)).rejects.toThrow("boom");
    expect(mutationFn).toHaveBeenCalledTimes(1);
  });
});
