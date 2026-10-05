// Full-length production exam simulation.
//
// Models one real student per VU for the entire exam window: login, agree,
// start, answer every question, heartbeat, refresh the access token before it
// expires, then submit. Unlike exam-flow.k6.js (a short throughput probe) this
// script holds each VU for the full exam duration so the server sees a
// realistic sustained load rather than a burst.
//
// Credentials are read from a JSON file in the init context so passwords never
// appear in argv, `ps`, or CI logs. Only the account count is ever logged.

import http from "k6/http";
import exec from "k6/execution";
import { check, fail, sleep } from "k6";
import { Counter, Gauge, Rate, Trend } from "k6/metrics";
import { SharedArray } from "k6/data";

const BASE_URL = (__ENV.BASE_URL || "http://localhost:5000").replace(/\/+$/, "");
const ACCOUNTS_FILE = __ENV.ACCOUNTS_FILE || "student_accounts.json";
const TEST_ID = __ENV.TEST_ID || "";
const PROFILE = String(__ENV.PROFILE || "500").trim();

const EXAM_DURATION_SECONDS = Number(__ENV.EXAM_DURATION_SECONDS || 65 * 60);
const EXAM_MARGIN_SECONDS = Number(__ENV.EXAM_MARGIN_SECONDS || 90);

// The backend marks a student DISCONNECTED after 20s without a heartbeat
// (tests.controller.js HEARTBEAT_STALE_SECONDS) and auto-submits after 15
// minutes of silence, so this must stay comfortably under 20s.
const HEARTBEAT_INTERVAL_SECONDS = Number(__ENV.HEARTBEAT_INTERVAL_SECONDS || 15);

const ACCESS_TOKEN_TTL_SECONDS = Number(__ENV.ACCESS_TOKEN_TTL_SECONDS || 15 * 60);
const TOKEN_REFRESH_RATIO = Number(__ENV.TOKEN_REFRESH_RATIO || 0.7);

const RUN_SUBMIT = String(__ENV.RUN_SUBMIT || "true").toLowerCase() === "true";
const DEBUG_FAILURES = String(__ENV.DEBUG_FAILURES || "false").toLowerCase() === "true";
const FAILURE_BACKOFF_SECONDS = Number(__ENV.FAILURE_BACKOFF_SECONDS || 5);

const PROFILES = {
  500: { targetUsers: 500, rampUpSeconds: 5 * 60 },
  1000: { targetUsers: 1000, rampUpSeconds: 8 * 60 },
};

const selected = PROFILES[PROFILE];
if (!selected) {
  throw new Error(`Unknown PROFILE "${PROFILE}". Use one of: ${Object.keys(PROFILES).join(", ")}`);
}

const TARGET_USERS = Number(__ENV.TARGET_USERS || selected.targetUsers);
const RAMP_UP = Number(__ENV.RAMP_UP_SECONDS || selected.rampUpSeconds);
const WARMUP = Number(__ENV.WARMUP_USERS || Math.floor(TARGET_USERS / 2));

// Each VU starts its exam as it is ramped up and then runs for EXAM_DURATION,
// so the hold stage must outlast the ramp plus one full exam.
const HOLD_SECONDS = RAMP_UP + EXAM_DURATION_SECONDS + 2 * 60;
const RAMPDOWN_SECONDS = Number(__ENV.RAMPDOWN_SECONDS || 2 * 60);

const accounts = new SharedArray("load test accounts", () => {
  let parsed;
  try {
    parsed = JSON.parse(open(ACCOUNTS_FILE));
  } catch (error) {
    throw new Error(`Could not read accounts from ${ACCOUNTS_FILE}: ${error.message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`${ACCOUNTS_FILE} must contain a non-empty JSON array of { identifier, password }`);
  }
  for (const entry of parsed) {
    if (!entry || typeof entry.identifier !== "string" || typeof entry.password !== "string") {
      throw new Error(`${ACCOUNTS_FILE} contains an entry without string identifier/password fields`);
    }
  }
  return parsed;
});

// Metric names follow k6's own convention (no unit suffix, as with the built-in
// `http_req_duration`) so the Prometheus remote-write output produces predictable
// series: counters get `_total`, rates get `_rate`, trends get the stat suffix.
//
//   answer_save_latency   -> k6_answer_save_latency_p95
//   answer_saves          -> k6_answer_saves_total
//   answer_success        -> k6_answer_success_rate
const apiFailures = new Counter("api_failures");
const rateLimitedRequests = new Counter("rate_limited_requests");
const answerSaves = new Counter("answer_saves");
const loginSuccess = new Rate("login_success");
const examStartSuccess = new Rate("exam_start_success");
const answerSuccess = new Rate("answer_success");
const submitSuccess = new Rate("submit_success");
const answerLatency = new Trend("answer_save_latency", true);
const heartbeatLatency = new Trend("heartbeat_latency", true);
const startLatency = new Trend("exam_start_latency", true);
const submitLatency = new Trend("exam_submit_latency", true);
const activeExams = new Gauge("exams_in_progress");

export const options = {
  tags: { profile: PROFILE, test_id: TEST_ID || "auto" },
  scenarios: {
    exam: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: `${RAMP_UP}s`, target: WARMUP },
        { duration: `${RAMP_UP}s`, target: TARGET_USERS },
        { duration: `${HOLD_SECONDS}s`, target: TARGET_USERS },
        { duration: `${RAMPDOWN_SECONDS}s`, target: 0 },
      ],
      // Let in-flight exams finish and submit instead of being cut off.
      gracefulRampDown: `${EXAM_DURATION_SECONDS + 300}s`,
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<2000", "p(99)<5000"],
    login_success: ["rate>0.99"],
    exam_start_success: ["rate>0.98"],
    answer_success: ["rate>0.99"],
    submit_success: ["rate>0.95"],
    rate_limited_requests: ["count<200"],
  },
};

export function setup() {
  if (accounts.length < TARGET_USERS) {
    fail(`${ACCOUNTS_FILE} has ${accounts.length} accounts but this profile needs ${TARGET_USERS}`);
  }
  console.log(
    `Loaded ${accounts.length} accounts. Running ${TARGET_USERS} concurrent ${EXAM_DURATION_SECONDS}s exams (profile=${PROFILE}, submit=${RUN_SUBMIT}).`
  );
  return { accountCount: accounts.length };
}

const session = { accessToken: null, refreshToken: null, expiresAt: 0 };

const pickAccount = () => {
  const index = (exec.vu.idInTest - 1) % accounts.length;
  return accounts[index];
};

const jsonHeaders = (token) => ({
  "Content-Type": "application/json",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

const safeJson = (response) => {
  try {
    return response.json();
  } catch {
    return {};
  }
};

const clientSessionId = () => `k6-prod-vu-${exec.vu.idInTest}`;

const retryAfterSeconds = (response) => {
  const header = Number(response.headers?.["Retry-After"] || response.headers?.["retry-after"] || 0);
  if (Number.isFinite(header) && header > 0) return header;
  const body = Number(safeJson(response)?.details?.retryAfterSeconds || 0);
  return Number.isFinite(body) && body > 0 ? body : 0;
};

const expectOk = (response, route, acceptedStatuses = [200]) => {
  const ok = acceptedStatuses.includes(response.status);
  if (response.status === 429) {
    rateLimitedRequests.add(1, { route });
  }
  if (!ok) {
    apiFailures.add(1, { route, status: String(response.status) });
    if (DEBUG_FAILURES) {
      const body = String(response.body || "").slice(0, 300);
      console.error(`${route} failed: status=${response.status} body=${body}`);
    }
  }
  check(response, { [`${route} ok`]: () => ok });
  return ok;
};

const sleepAfterFailure = (response) => {
  const wait = Math.min(Math.max(retryAfterSeconds(response), FAILURE_BACKOFF_SECONDS), 30);
  sleep(wait);
};

const login = (account) => {
  const response = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ identifier: account.identifier, password: account.password }),
    { headers: jsonHeaders(), tags: { route: "login" } }
  );

  const ok = expectOk(response, "login", [200]);
  loginSuccess.add(ok);
  if (!ok) {
    sleepAfterFailure(response);
    return false;
  }

  const payload = safeJson(response);
  const token = payload.accessToken;
  if (!token) {
    apiFailures.add(1, { route: "login", status: "missing_access_token" });
    return false;
  }

  session.accessToken = token;
  session.refreshToken = payload.refreshToken || null;
  session.expiresAt = Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000;
  return true;
};

// The refresh token lives in an HttpOnly cookie, so k6 replays it from the
// response cookie jar. Body is sent too for deployments that also accept it.
const refreshAccessToken = () => {
  const response = http.post(
    `${BASE_URL}/api/auth/refresh`,
    JSON.stringify({ refreshToken: session.refreshToken || undefined }),
    { headers: jsonHeaders(), tags: { route: "refresh" } }
  );

  const ok = expectOk(response, "refresh", [200]);
  if (!ok) {
    // A failed refresh is recoverable: log in again with the same account.
    const account = pickAccount();
    if (!login(account)) return false;
    return true;
  }

  const token = safeJson(response).accessToken;
  if (!token) return false;
  session.accessToken = token;
  session.refreshToken = safeJson(response).refreshToken || session.refreshToken;
  session.expiresAt = Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000;
  return true;
};

const resolveTest = (ongoing) => {
  const items = Array.isArray(ongoing) ? ongoing : [];
  if (TEST_ID) {
    return items.find((test) => String(test.id) === String(TEST_ID)) || null;
  }
  return (
    items.find((test) => test.submissionId) ||
    items.find((test) => !test.isCompleted && Number(test.attemptsRemaining || 0) > 0) ||
    null
  );
};

const buildAnswerPayload = (question, vuSeed) => {
  const base = {
    questionId: question.id,
    markedForReview: false,
    clientSessionId: clientSessionId(),
  };

  const type = String(question.type || "mcq").toLowerCase();
  if (type === "true_false") {
    return { ...base, answerBoolean: true };
  }
  if (type === "fill_blank" || type === "paragraph") {
    return { ...base, answerText: `load test answer ${vuSeed}` };
  }

  const options = Array.isArray(question.options) ? question.options : [];
  if (options.length === 0) {
    return { ...base, answerText: `load test answer ${vuSeed}` };
  }
  // Spread selections across VUs instead of always picking the first option.
  const choice = options[vuSeed % options.length];
  return { ...base, selectedOption: choice, selectedOptions: [choice] };
};

export default function exam() {
  const account = pickAccount();

  if (!session.accessToken || Date.now() >= session.expiresAt) {
    if (!login(account)) return;
  }

  const ongoingResponse = http.get(`${BASE_URL}/api/tests/ongoing`, {
    headers: jsonHeaders(session.accessToken),
    tags: { route: "ongoing" },
  });
  if (!expectOk(ongoingResponse, "ongoing", [200])) {
    sleepAfterFailure(ongoingResponse);
    return;
  }

  const test = resolveTest(safeJson(ongoingResponse));
  if (!test) {
    apiFailures.add(1, { route: "ongoing", status: "no_startable_test" });
    return;
  }
  const testId = test.id;

  const agreeResponse = http.post(
    `${BASE_URL}/api/tests/${testId}/agree`,
    JSON.stringify({ agreed: true }),
    { headers: jsonHeaders(session.accessToken), tags: { route: "agree" } }
  );
  if (!expectOk(agreeResponse, "agree", [200])) {
    sleepAfterFailure(agreeResponse);
    return;
  }

  const startResponse = http.post(
    `${BASE_URL}/api/tests/${testId}/start`,
    JSON.stringify({ clientSessionId: clientSessionId() }),
    { headers: jsonHeaders(session.accessToken), tags: { route: "start" } }
  );
  startLatency.add(startResponse.timings.duration);
  const startedOk = expectOk(startResponse, "start", [200, 201]);
  examStartSuccess.add(startedOk);
  if (!startedOk) {
    sleepAfterFailure(startResponse);
    return;
  }

  const startPayload = safeJson(startResponse);
  const submissionId = startPayload.submission?.id || startPayload.submissionId;
  if (!submissionId) {
    apiFailures.add(1, { route: "start", status: "missing_submission" });
    return;
  }

  const presentedQuestions = Array.isArray(startPayload.questions) ? startPayload.questions : [];
  const questionIds = (
    Array.isArray(startPayload.question_order) && startPayload.question_order.length > 0
      ? startPayload.question_order
      : presentedQuestions.map((question) => question.id)
  ).filter(Boolean);
  const questionById = new Map(presentedQuestions.map((question) => [question.id, question]));

  const serverEndMs = Number(startPayload.server_end_time || 0);
  const examEndAt = Math.min(
    Date.now() + EXAM_DURATION_SECONDS * 1000,
    (Number.isFinite(serverEndMs) && serverEndMs > Date.now() ? serverEndMs : Infinity) - EXAM_MARGIN_SECONDS * 1000
  );

  const answerIntervalMs = questionIds.length > 0 ? (examEndAt - Date.now()) / questionIds.length : Infinity;
  let questionIndex = 0;
  let nextAnswerAt = Date.now();
  let nextHeartbeatAt = Date.now() + HEARTBEAT_INTERVAL_SECONDS * 1000;
  let nextRefreshAt = Date.now() + ACCESS_TOKEN_TTL_SECONDS * TOKEN_REFRESH_RATIO * 1000;
  let answerOk = true;
  let consecutiveFailures = 0;

  activeExams.add(1);

  const heartbeat = () => {
    const response = http.post(
      `${BASE_URL}/api/tests/${testId}/heartbeat`,
      JSON.stringify({ submissionId, clientSessionId: clientSessionId() }),
      { headers: jsonHeaders(session.accessToken), tags: { route: "heartbeat" } }
    );
    heartbeatLatency.add(response.timings.duration);
    const payload = safeJson(response);
    // A 200 with autoSubmitted means the server ended the attempt for us.
    if (response.status === 200 && payload.autoSubmitted) {
      apiFailures.add(1, { route: "heartbeat", status: "auto_submitted" });
      return false;
    }
    expectOk(response, "heartbeat", [200]);
    return response.status === 200;
  };

  while (Date.now() < examEndAt) {
    const now = Date.now();

    if (now >= nextRefreshAt) {
      if (!refreshAccessToken()) break;
      nextRefreshAt = Date.now() + ACCESS_TOKEN_TTL_SECONDS * TOKEN_REFRESH_RATIO * 1000;
      continue;
    }

    if (now >= nextHeartbeatAt) {
      if (!heartbeat()) break;
      nextHeartbeatAt = Date.now() + HEARTBEAT_INTERVAL_SECONDS * 1000;
      continue;
    }

    if (questionIndex < questionIds.length && now >= nextAnswerAt) {
      const questionId = questionIds[questionIndex];
      const question = questionById.get(questionId) || { id: questionId, type: "mcq", options: [] };
      const response = http.post(
        `${BASE_URL}/api/tests/${testId}/answer`,
        JSON.stringify({
          submissionId,
          ...buildAnswerPayload(question, exec.vu.idInTest + questionIndex),
        }),
        { headers: jsonHeaders(session.accessToken), tags: { route: "answer" } }
      );

      answerLatency.add(response.timings.duration);
      answerSaves.add(1);
      const ok = expectOk(response, "answer", [200]);
      answerSuccess.add(ok);
      answerOk = answerOk && ok;

      questionIndex += 1;
      nextAnswerAt = Date.now() + answerIntervalMs;

      if (!ok) {
        consecutiveFailures += 1;
        if (consecutiveFailures >= 3) {
          apiFailures.add(1, { route: "answer", status: "abandoned_after_repeated_failures" });
          break;
        }
        sleepAfterFailure(response);
      } else {
        consecutiveFailures = 0;
      }
      continue;
    }

    const wakeAt = Math.min(
      nextHeartbeatAt,
      nextRefreshAt,
      questionIndex < questionIds.length ? nextAnswerAt : examEndAt,
      examEndAt
    );
    sleep(Math.max((wakeAt - Date.now()) / 1000, 0.1));
  }

  activeExams.add(-1);

  if (!answerOk) {
    apiFailures.add(1, { route: "exam", status: "answers_incomplete" });
  }

  if (!RUN_SUBMIT) return;

  const submitResponse = http.post(
    `${BASE_URL}/api/tests/${testId}/submit`,
    JSON.stringify({ submissionId, reason: "load_test", clientSessionId: clientSessionId() }),
    { headers: jsonHeaders(session.accessToken), tags: { route: "submit" } }
  );
  submitLatency.add(submitResponse.timings.duration);

  // 409 SUBMISSION_ALREADY_COMPLETED means the attempt ended on its own terms
  // (time expiry or heartbeat auto-submit), which is a successful outcome here.
  const submitPayload = safeJson(submitResponse);
  const alreadyCompleted = submitResponse.status === 409 && submitPayload.code === "SUBMISSION_ALREADY_COMPLETED";
  const ok = expectOk(submitResponse, "submit", alreadyCompleted ? [409] : [200, 201, 202]);
  submitSuccess.add(ok);
}