import { QueryClient } from '@tanstack/react-query';

/** The app's single query cache (module-level so non-hook helpers can update it). */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
});
