/**
 * App-wide TanStack QueryClient factory (used by the client providers in
 * src/app/providers.tsx and src/components/domain/shared/app-providers.tsx).
 *
 * The MutationCache carries a global onError fallback toast so a mutation
 * without its own `onError` can never fail silently (audit UI-7/SF-8 — the
 * Square-enable and channel-format toggles shipped without handlers and
 * failed writes looked like saved toggles). Mutations that define `onError`
 * keep their specific messaging and are skipped here; call sites that handle
 * errors around `mutateAsync` (try/catch) instead of on the mutation can opt
 * out via `meta: { suppressGlobalErrorToast: true }`.
 */
import { MutationCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CACHE_DURATIONS } from "@/lib/constants";
import { parseUnknownError } from "@/lib/errors";

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (mutation.options.onError) return; // specific handler owns messaging
        if (mutation.meta?.suppressGlobalErrorToast) return; // handled at the call site
        toast.error(parseUnknownError(error).message);
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
        gcTime: 5 * 60 * 1000,
        retry: 1,
        refetchOnWindowFocus: process.env.NODE_ENV === "production",
      },
      mutations: {
        retry: false,
      },
    },
  });
}
