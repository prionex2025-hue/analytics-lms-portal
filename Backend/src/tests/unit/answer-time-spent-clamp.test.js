/**
 * Regression coverage for the server-side clamp on per-question timing.
 *
 * `timeSpentSeconds` arrives from the browser and is stored as-is, so it feeds
 * per-question analytics. Previously any non-negative number was accepted,
 * meaning a single request could post an absurd duration and poison the
 * reporting numbers. The service now clamps to the attempt's own wall-clock
 * budget (server-owned) plus an absolute per-question ceiling.
 *
 * These assertions run against the real exported helper rather than a copy.
 */

jest.mock("../../models", () => ({ init: jest.fn() }));

const { clampTimeSpentSeconds } = require("../../services/answer.service");

const clamp = (raw, submission) => clampTimeSpentSeconds(raw, { submission });

describe("timeSpentSeconds clamp", () => {
  const attemptStartedFiveMinutesAgo = {
    startedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  };

  const attemptStartedSixHoursAgo = {
    startedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
  };

  it("keeps a plausible value unchanged", () => {
    expect(clamp(120, attemptStartedFiveMinutesAgo)).toBe(120);
  });

  it("clamps an absurd value to the elapsed attempt time", () => {
    // 5 minutes of attempt cannot contain 10 hours of question time.
    const clamped = clamp(36_000, attemptStartedFiveMinutesAgo);
    expect(clamped).toBeLessThanOrEqual(300);
    expect(clamped).toBeGreaterThan(0);
  });

  it("clamps non-finite input to zero", () => {
    expect(clamp(Infinity, attemptStartedFiveMinutesAgo)).toBe(0);
    expect(clamp(NaN, attemptStartedFiveMinutesAgo)).toBe(0);
  });

  it("rejects negative input", () => {
    expect(clamp(-50, attemptStartedFiveMinutesAgo)).toBe(0);
  });

  it("applies the absolute per-question ceiling for long attempts", () => {
    // Even after 6 hours of attempt time, one question is capped at 30 minutes.
    expect(clamp(20_000, attemptStartedSixHoursAgo)).toBe(30 * 60);
  });

  it("still bounds input when the attempt has no start time", () => {
    expect(clamp(1e12, {})).toBe(30 * 60);
  });

  it("still bounds input when no submission is supplied at all", () => {
    expect(clamp(1e12, undefined)).toBe(30 * 60);
  });

  it("returns zero when nothing is provided", () => {
    expect(clamp(undefined, attemptStartedFiveMinutesAgo)).toBe(0);
    expect(clamp(null, attemptStartedFiveMinutesAgo)).toBe(0);
  });

  it("truncates fractional seconds rather than storing them", () => {
    expect(Number.isInteger(clamp(10.9, attemptStartedFiveMinutesAgo))).toBe(true);
  });
});