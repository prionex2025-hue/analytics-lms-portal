import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        const status = Number(error?.status || 0);
        if (status === 429) {
          return false;
        }

        if (status >= 400 && status < 500) {
          return false;
        }

        return failureCount < 1;
      },
    },
  },
});
