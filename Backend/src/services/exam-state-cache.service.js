const { redisClient, isRedisAvailable } = require("../config/redis");

const EXAM_STATE_TTL_SECONDS = 2 * 60 * 60;

const buildExamStateKey = ({ userId, testId }) => {
  return `exam_state:user:${userId}:test:${testId}`;
};

const normalizeState = (state) => {
  const nowIso = new Date().toISOString();
  return {
    submissionId: state?.submissionId ? String(state.submissionId) : "",
    status: state?.status ? String(state.status) : "IN_PROGRESS",
    lastHeartbeatAt: state?.lastHeartbeatAt ? new Date(state.lastHeartbeatAt).toISOString() : nowIso,
    lastAutoSavedAt: state?.lastAutoSavedAt ? new Date(state.lastAutoSavedAt).toISOString() : nowIso,
    connectionStatus: state?.connectionStatus ? String(state.connectionStatus) : "ONLINE",
    violationCount: Number.isFinite(Number(state?.violationCount)) ? String(Number(state.violationCount)) : "0",
    progress: Number.isFinite(Number(state?.progress)) ? String(Math.max(0, Number(state.progress))) : "0",
    // MODULE_TEST only (empty for OPEN_TEST). Mongo remains authoritative.
    currentModuleKey: state?.currentModuleKey ? String(state.currentModuleKey) : "",
    moduleExpiresAt: state?.moduleExpiresAt ? new Date(state.moduleExpiresAt).toISOString() : "",
  };
};

const setExamState = async ({ userId, testId, state, ttlSeconds = EXAM_STATE_TTL_SECONDS }) => {
  if (!isRedisAvailable() || !userId || !testId) {
    return;
  }

  const key = buildExamStateKey({ userId, testId });
  const payload = normalizeState(state);

  try {
    await redisClient.hset(key, payload);
    await redisClient.expire(key, Math.max(30, ttlSeconds));
  } catch {
    // Fail-open.
  }
};

const getExamState = async ({ userId, testId }) => {
  if (!isRedisAvailable() || !userId || !testId) {
    return null;
  }

  try {
    const key = buildExamStateKey({ userId, testId });
    const data = await redisClient.hgetall(key);
    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
};

const clearExamState = async ({ userId, testId }) => {
  if (!isRedisAvailable() || !userId || !testId) {
    return;
  }

  try {
    const key = buildExamStateKey({ userId, testId });
    await redisClient.del(key);
  } catch {
    // Fail-open.
  }
};

module.exports = {
  setExamState,
  getExamState,
  clearExamState,
};
