import { QueryClient } from "@tanstack/react-query";
import { CACHE_DURATIONS } from "@/lib/constants";

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
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
