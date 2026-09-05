import { QueryClient } from "@tanstack/react-query";

export const BUSINESS_QUERY_STALE_TIME_MS = 5 * 60_000;
export const BUSINESS_QUERY_GC_TIME_MS = 30 * 60_000;

export function createKdosQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: BUSINESS_QUERY_STALE_TIME_MS,
        gcTime: BUSINESS_QUERY_GC_TIME_MS,
        refetchOnMount: true,
        refetchOnWindowFocus: false,
        placeholderData: (previous: unknown) => previous
      }
    }
  });
}

export const queryClient = createKdosQueryClient();
