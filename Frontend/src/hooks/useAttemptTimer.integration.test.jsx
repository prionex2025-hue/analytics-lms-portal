import { renderHook, waitFor } from "@testing-library/react";
import { useAttemptTimer } from "@/hooks/useAttemptTimer";

describe("useAttemptTimer integration", () => {
  it("expires exactly once and calls onExpired", async () => {
    const onExpired = vi.fn();

    renderHook(() => useAttemptTimer({ serverEndTime: Date.now() + 50, onExpired }));

    await waitFor(() => {
      expect(onExpired).toHaveBeenCalledTimes(1);
    }, {
      timeout: 1000,
    });
  });
});
