const {
  shouldEmitPresence,
  clearPresenceThrottle,
  PRESENCE_EMIT_INTERVAL_MS,
} = require("../../services/presence-throttle.service");

describe("presence throttle", () => {
  beforeEach(() => {
    clearPresenceThrottle();
  });

  it("lets the first heartbeat in a window through and swallows the rest", () => {
    const t0 = 1_000_000;
    expect(shouldEmitPresence("sub-1", t0)).toBe(true);
    expect(shouldEmitPresence("sub-1", t0 + 1_000)).toBe(false);
    expect(shouldEmitPresence("sub-1", t0 + PRESENCE_EMIT_INTERVAL_MS - 1)).toBe(false);
    expect(shouldEmitPresence("sub-1", t0 + PRESENCE_EMIT_INTERVAL_MS)).toBe(true);
  });

  it("throttles per submission, not globally", () => {
    const t0 = 2_000_000;
    expect(shouldEmitPresence("sub-1", t0)).toBe(true);
    expect(shouldEmitPresence("sub-2", t0)).toBe(true);
    expect(shouldEmitPresence("sub-1", t0 + 1_000)).toBe(false);
    expect(shouldEmitPresence("sub-2", t0 + 1_000)).toBe(false);
  });

  it("rejects missing submission ids", () => {
    expect(shouldEmitPresence(null)).toBe(false);
    expect(shouldEmitPresence("")).toBe(false);
  });
});
