/**
 * MODULE_TEST attempt state machine (server-authoritative).
 *
 * A MODULE_TEST runs a fixed ordered set of modules (Quant -> Reasoning -> Verbal),
 * each with its own independent timer. Authority lives in MongoDB:
 *   - submission.moduleState[]   per-module status/timing/score
 *   - submission.currentModuleKey / submission.moduleExpiresAt
 *   - testSession.currentModuleKey / testSession.moduleExpiresAt / testSession.moduleOrder
 *   - testSession.expiresAt      whole-test hard cap = start + sum(durations)
 *
 * The per-module deadline is anchored at the moment a module becomes ACTIVE
 * (so finishing early never carries unused time to the next module) and is
 * clamped to the whole-test hard cap. Client timers are display-only.
 */
const { completeSubmission } = require("./test.service");
const { isModuleTest, normalizeQuestionCategory } = require("./test-config.service");

const MODULE_STATUS = Object.freeze({
  NOT_STARTED: "NOT_STARTED",
  ACTIVE: "ACTIVE",
  MANUAL_SUBMIT: "MANUAL_SUBMIT",
  AUTO_SUBMIT: "AUTO_SUBMIT",
  EXPIRED: "EXPIRED",
  COMPLETED: "COMPLETED",
});

const isModuleAttempt = (test) => isModuleTest(test) && Array.isArray(test?.modules) && test.modules.length > 0;

const sortedModules = (test) =>
  Array.isArray(test?.modules) ? test.modules.slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0)) : [];

const getModuleByKey = (test, key) => sortedModules(test).find((mod) => mod.key === key) || null;

const getNextModule = (test, key) => {
  const mods = sortedModules(test);
  const index = mods.findIndex((mod) => mod.key === key);
  return index >= 0 && index + 1 < mods.length ? mods[index + 1] : null;
};

const questionCategory = (question) =>
  normalizeQuestionCategory(question?.category) || (question?.category != null ? String(question.category) : null);

// Keep only the questions that belong to a given module's category.
const filterQuestionsForModule = (questions, mod) => {
  if (!mod) return [];
  return (Array.isArray(questions) ? questions : []).filter((question) => questionCategory(question) === mod.category);
};

// Initial module state + timing for a fresh MODULE_TEST attempt.
const buildInitialModuleState = (test, startedAt = new Date()) => {
  const mods = sortedModules(test);
  const startMs = new Date(startedAt).getTime();
  const totalMins = mods.reduce((sum, mod) => sum + (Number(mod.durationMins) || 0), 0);
  const first = mods[0] || null;

  const moduleState = mods.map((mod) => ({
    key: mod.key,
    name: mod.name,
    order: mod.order,
    category: mod.category,
    configuredDurationMins: Number(mod.durationMins) || 0,
    startedAt: mod.order === (first ? first.order : 1) ? new Date(startMs) : null,
    endedAt: null,
    timeTakenSeconds: 0,
    status: mod.order === (first ? first.order : 1) ? MODULE_STATUS.ACTIVE : MODULE_STATUS.NOT_STARTED,
    score: 0,
    maxScore: 0,
    percentage: 0,
  }));

  return {
    moduleState,
    currentModuleKey: first ? first.key : null,
    moduleExpiresAt: first ? new Date(startMs + (Number(first.durationMins) || 0) * 60000) : null,
    expiresAt: new Date(startMs + totalMins * 60000),
  };
};

// Clamp a proposed module deadline to the whole-test hard cap.
const clampToHardCap = (deadlineMs, session) => {
  const capMs = session?.expiresAt ? new Date(session.expiresAt).getTime() : NaN;
  return Number.isFinite(capMs) ? new Date(Math.min(deadlineMs, capMs)) : new Date(deadlineMs);
};

const isModuleExpired = (session, now = new Date()) => {
  const expiresAtMs = session?.moduleExpiresAt ? new Date(session.moduleExpiresAt).getTime() : NaN;
  return Number.isFinite(expiresAtMs) && now.getTime() > expiresAtMs;
};

// Advance the current module: finalize it, then activate the next one or complete
// the whole attempt. Race-safe via a conditional update on currentModuleKey.
const advanceModule = async ({ db, test, submission, session, fromModuleKey, now = new Date(), autoSubmitted = false }) => {
  const currentKey = submission.currentModuleKey || (session && session.currentModuleKey);

  // Idempotency: a stale/duplicate request naming a module that is no longer
  // current is treated as already-advanced.
  if (fromModuleKey && currentKey && String(fromModuleKey) !== String(currentKey)) {
    return { status: "IDEMPOTENT", currentModuleKey: currentKey };
  }

  const expired = isModuleExpired(session, now);
  // The whole-test deadline is absolute and is NOT the same as the module
  // deadline. Without this check a student who let the clock run out could keep
  // clicking "Submit Section & Continue"; on the final module that reached
  // completeSubmission({ autoSubmitted: false }) and recorded the attempt as
  // MANUAL instead of AUTO_SUBMIT, granting time past the hard cap.
  const hardCapExpired = Boolean(
    session?.expiresAt && now.getTime() > new Date(session.expiresAt).getTime()
  );
  const shouldAutoSubmit = autoSubmitted || hardCapExpired;
  const existingModuleState = Array.isArray(submission.moduleState) ? submission.moduleState : [];

  const finalizedModuleState = existingModuleState.map((ms) => {
    if (ms.key !== currentKey) return ms;
    const startedAtMs = ms.startedAt ? new Date(ms.startedAt).getTime() : now.getTime();
    return {
      ...ms,
      endedAt: now,
      timeTakenSeconds: Math.max(0, Math.floor((now.getTime() - startedAtMs) / 1000)),
      status: expired || hardCapExpired ? MODULE_STATUS.EXPIRED : shouldAutoSubmit ? MODULE_STATUS.AUTO_SUBMIT : MODULE_STATUS.MANUAL_SUBMIT,
    };
  });

  // Once the hard cap is gone there is no next module to hand out a deadline to;
  // finalize the attempt instead of advancing into an already-expired module.
  const next = hardCapExpired ? null : getNextModule(test, currentKey);

  if (next) {
    const nextExpiresAt = clampToHardCap(now.getTime() + (Number(next.durationMins) || 0) * 60000, session);
    const nextModuleState = finalizedModuleState.map((ms) =>
      ms.key === next.key ? { ...ms, status: MODULE_STATUS.ACTIVE, startedAt: now } : ms
    );

    // Conditional write: only the request that still sees `currentKey` wins.
    const result = await db.submission.updateMany({
      where: { id: submission.id, currentModuleKey: currentKey, status: "IN_PROGRESS" },
      data: { moduleState: nextModuleState, currentModuleKey: next.key, moduleExpiresAt: nextExpiresAt },
    });

    if (!result || (result.count || 0) === 0) {
      const fresh = await db.submission.findUnique({ where: { id: submission.id } });
      return { status: "IDEMPOTENT", currentModuleKey: fresh?.currentModuleKey || next.key };
    }

    await db.testSession.updateMany({
      where: { userId: submission.userId, testId: submission.testId, endedAt: null },
      data: { currentModuleKey: next.key, moduleExpiresAt: nextExpiresAt, moduleOrder: next.order },
    });

    return { status: "ADVANCED", nextModule: next, moduleExpiresAt: nextExpiresAt };
  }

  // Last module: persist finalized timing, then complete the whole attempt.
  const result = await db.submission.updateMany({
    where: { id: submission.id, currentModuleKey: currentKey, status: "IN_PROGRESS" },
    data: { moduleState: finalizedModuleState },
  });

  if (!result || (result.count || 0) === 0) {
    const fresh = await db.submission.findUnique({ where: { id: submission.id } });
    if (fresh && fresh.status !== "IN_PROGRESS") {
      const { calculateSubmissionScore } = require("./test.service");
      const summary = await calculateSubmissionScore(submission.id);
      return { status: "COMPLETED", submission: fresh, summary, alreadyCompleted: true };
    }
    return { status: "IDEMPOTENT", currentModuleKey: fresh?.currentModuleKey || currentKey };
  }

  const completed = (await completeSubmission({ submissionId: submission.id, autoSubmitted: shouldAutoSubmit, withSummary: true })) || {};
  return { status: "COMPLETED", submission: completed.submission, summary: completed.summary };
};

// On resume/reconnect: auto-advance any module whose server deadline has passed.
// Each advance sets a fresh future deadline for the next module, so this settles
// in one step under normal conditions (guarded regardless).
const autoAdvanceExpiredModules = async ({ db, test, submission, session, now = new Date(), reloadSubmission, reloadSession }) => {
  let sub = submission;
  let sess = session;
  let guard = 0;

  while (
    sub &&
    sub.status === "IN_PROGRESS" &&
    sess &&
    !sess.endedAt &&
    isModuleExpired(sess, now) &&
    guard < 6
  ) {
    const result = await advanceModule({
      db,
      test,
      submission: sub,
      session: sess,
      fromModuleKey: sub.currentModuleKey,
      now,
      autoSubmitted: true,
    });
    guard += 1;

    if (result.status === "COMPLETED") {
      sub = result.submission || (await reloadSubmission());
      sess = await reloadSession();
      break;
    }

    sub = await reloadSubmission();
    sess = await reloadSession();
  }

  return { submission: sub, session: sess };
};

// Shape the current-module info for the client (no answer keys). `remainingMs`
// is derived by the client from server_module_end_time; we also send module list.
const buildModuleView = ({ test, submission, session }) => {
  const mods = sortedModules(test);
  const currentKey = submission?.currentModuleKey || session?.currentModuleKey || (mods[0] && mods[0].key) || null;
  const current = getModuleByKey(test, currentKey);
  const stateByKey = new Map((submission?.moduleState || []).map((ms) => [ms.key, ms]));

  return {
    current_module: current
      ? { key: current.key, name: current.name, order: current.order, durationMins: current.durationMins }
      : null,
    server_module_end_time: session?.moduleExpiresAt ? new Date(session.moduleExpiresAt).getTime() : null,
    modules: mods.map((mod) => {
      const ms = stateByKey.get(mod.key) || {};
      return {
        key: mod.key,
        name: mod.name,
        order: mod.order,
        durationMins: mod.durationMins,
        status: ms.status || MODULE_STATUS.NOT_STARTED,
        isCurrent: mod.key === currentKey,
      };
    }),
  };
};

module.exports = {
  MODULE_STATUS,
  isModuleAttempt,
  sortedModules,
  getModuleByKey,
  getNextModule,
  filterQuestionsForModule,
  buildInitialModuleState,
  isModuleExpired,
  advanceModule,
  autoAdvanceExpiredModules,
  buildModuleView,
  clampToHardCap,
};
