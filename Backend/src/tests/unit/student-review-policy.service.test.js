const {
  canRevealCorrectAnswers,
  isTestCompleted,
  maskCorrectAnswer,
} = require("../../services/student-review-policy.service");

const MINUTE = 60 * 1000;
const future = () => new Date(Date.now() + 60 * MINUTE);
const past = () => new Date(Date.now() - 60 * MINUTE);

describe("student review policy", () => {
  describe("while the test is live", () => {
    const liveTest = { status: "LIVE", startsAt: past(), endsAt: future() };

    it("hides correct answers by default (score-only / after-deadline modes)", () => {
      expect(isTestCompleted(liveTest)).toBe(false);
      expect(canRevealCorrectAnswers(liveTest)).toBe(false);
      expect(canRevealCorrectAnswers({ ...liveTest, reviewMode: "show_score_only" })).toBe(false);
      expect(canRevealCorrectAnswers({ ...liveTest, reviewMode: "show_after_deadline" })).toBe(false);
      expect(maskCorrectAnswer("B", liveTest)).toBeNull();
    });

    it("reveals immediately only when the instructor chose show_all", () => {
      expect(canRevealCorrectAnswers({ ...liveTest, reviewMode: "show_all" })).toBe(true);
      expect(maskCorrectAnswer("B", { ...liveTest, reviewMode: "show_all" })).toBe("B");
    });
  });

  describe("once the test is over", () => {
    it("treats a closed window (endsAt < now) as completed and reveals answers", () => {
      const endedTest = { status: "LIVE", startsAt: past(), endsAt: past() };
      expect(isTestCompleted(endedTest)).toBe(true);
      expect(canRevealCorrectAnswers(endedTest)).toBe(true);
      expect(maskCorrectAnswer("B", endedTest)).toBe("B");
    });

    it("reveals for the legacy PUBLISHED status once the window has closed", () => {
      const endedLegacy = { status: "PUBLISHED", startsAt: past(), endsAt: past() };
      expect(canRevealCorrectAnswers(endedLegacy)).toBe(true);
    });

    it("reveals when explicitly marked COMPLETED even if endsAt is missing", () => {
      expect(canRevealCorrectAnswers({ status: "COMPLETED" })).toBe(true);
      expect(canRevealCorrectAnswers({ status: "ARCHIVED" })).toBe(true);
      expect(canRevealCorrectAnswers({ status: "LIVE", completedAt: past() })).toBe(true);
    });

    it("keeps an open-ended live test (no endsAt) hidden until explicitly completed", () => {
      const openEnded = { status: "LIVE", startsAt: past(), endsAt: null };
      expect(isTestCompleted(openEnded)).toBe(false);
      expect(canRevealCorrectAnswers(openEnded)).toBe(false);
    });
  });
});
