import { httpClient, toApiError } from "@/services/httpClient";

const withServerTime = (response) => ({
  data: response?.data,
  serverTime: response?.headers?.date ? new Date(response.headers.date).getTime() : Date.now(),
});

const TEST_CLIENT_ID_KEY = "lms:test:client-session-id";

const getOrCreateTestClientId = () => {
  try {
    const existing = sessionStorage.getItem(TEST_CLIENT_ID_KEY);
    if (existing) return existing;

    const next = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    sessionStorage.setItem(TEST_CLIENT_ID_KEY, next);
    return next;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }
};

const testSessionHeaders = () => ({
  "x-test-client-id": getOrCreateTestClientId(),
});

const getFilenameFromDisposition = (disposition = "") => {
  const filenameExtMatch = String(disposition).match(/filename\*=UTF-8''([^;]+)/i);
  if (filenameExtMatch?.[1]) {
    try {
      return decodeURIComponent(filenameExtMatch[1]);
    } catch {
      return filenameExtMatch[1];
    }
  }

  const filenameMatch = String(disposition).match(/filename="?([^";]+)"?/i);
  return filenameMatch?.[1] || "student-report.pdf";
};

const normalizeTestId = (item) => String(item?.id || item?.test_id || item?.testId || "");
const normalizeSubmissionId = (item) => String(item?.submissionId || item?.attempt_id || item?.attemptId || "");

const findResumableAttemptByTestId = (items, testId) => {
  const expectedTestId = String(testId || "");
  if (!expectedTestId || !Array.isArray(items)) {
    return null;
  }

  return (
    items.find((item) => {
      const itemTestId = normalizeTestId(item);
      const itemSubmissionId = normalizeSubmissionId(item);
      const latestStatus = String(item?.latestSubmissionStatus || "").toUpperCase();
      return itemTestId === expectedTestId && Boolean(itemSubmissionId) && latestStatus === "IN_PROGRESS";
    }) || null
  );
};

const fetchAttemptSessionDirect = async (attemptId) => {
  const response = await httpClient.get(`/attempts/${attemptId}`);
  return withServerTime(response).data;
};

const startAttemptInFlight = new Map();
let activeAttemptsInFlight = null;
const testSessionInFlight = new Map();
const submitAttemptInFlight = new Map();

const dedupeChangedAnswers = (items = []) => {
  const map = new Map();
  items.forEach((item) => {
    const questionId = item?.question_id;
    if (!questionId) return;
    map.set(String(questionId), item);
  });
  return [...map.values()];
};

const chunkArray = (items = [], size = 3) => {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

export const studentApi = {
  login: async (payload) => {
    try {
      const response = await httpClient.post("/auth/login", payload);
      return withServerTime(response).data;
    } catch (error) {
      throw toApiError(error);
    }
  },

  forgotPassword: async (payload) => {
    try {
      const response = await httpClient.post("/auth/forgot-password", payload);
      return response.data;
    } catch (error) {
      throw toApiError(error);
    }
  },

  resetPassword: async (payload) => {
    try {
      const response = await httpClient.post("/auth/reset-password", payload);
      return response.data;
    } catch (error) {
      throw toApiError(error);
    }
  },

  refreshSession: async (payload = {}) => {
    try {
      const response = await httpClient.post("/auth/refresh", payload);
      return withServerTime(response).data;
    } catch (error) {
      throw toApiError(error);
    }
  },

  me: async () => {
    try {
      const response = await httpClient.get("/auth/me");
      return response.data;
    } catch (error) {
      throw toApiError(error);
    }
  },

  logout: async (payload = {}) => {
    try {
      await httpClient.post("/auth/logout", payload);
    } catch (error) {
      throw toApiError(error);
    }
  },

  getEvents: async () => {
    try {
      const response = await httpClient.get("/events");
      const { data, serverTime } = withServerTime(response);
      return {
        items: Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [],
        serverTime,
      };
    } catch (error) {
      throw toApiError(error);
    }
  },

  registerEvent: async (eventId, payload = {}) => {
    try {
      const response = await httpClient.post(`/events/${eventId}/register`, payload);
      return response.data;
    } catch (error) {
      throw toApiError(error);
    }
  },

  uploadMyAvatar: async (file) => {
    const formData = new FormData();
    formData.append("avatar", file);

    try {
      const response = await httpClient.post("/profile/avatar", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
      return response.data;
    } catch (error) {
      const parsed = toApiError(error);
      if (parsed.status !== 404) {
        throw parsed;
      }

      try {
        const fallback = await httpClient.post("/students/me/avatar", formData, {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        });

        return fallback.data;
      } catch (fallbackError) {
        throw toApiError(fallbackError);
      }
    }
  },

  changeMyPassword: async (payload) => {
    try {
      const response = await httpClient.patch("/profile/password", payload);
      return response.data;
    } catch (error) {
      const parsed = toApiError(error);
      if (parsed.status !== 404) {
        throw parsed;
      }

      try {
        const fallback = await httpClient.patch("/students/me/password", payload);
        return fallback.data;
      } catch (fallbackError) {
        throw toApiError(fallbackError);
      }
    }
  },

  updateMyPreferences: async (payload) => {
    try {
      const response = await httpClient.patch("/profile/preferences", payload);
      return response.data;
    } catch (error) {
      const parsed = toApiError(error);
      if (parsed.status !== 404) {
        throw parsed;
      }

      try {
        const fallback = await httpClient.patch("/students/me/preferences", payload);
        return fallback.data;
      } catch (fallbackError) {
        throw toApiError(fallbackError);
      }
    }
  },

  requestAccountDeletion: async (payload) => {
    try {
      const response = await httpClient.delete("/profile", { data: payload });
      return response.data;
    } catch (error) {
      const parsed = toApiError(error);
      if (parsed.status !== 404) {
        throw parsed;
      }

      try {
        const fallback = await httpClient.delete("/students/me", { data: payload });
        return fallback.data;
      } catch (fallbackError) {
        throw toApiError(fallbackError);
      }
    }
  },

  getActiveAttempts: async () => {
    if (activeAttemptsInFlight) {
      return activeAttemptsInFlight;
    }

    try {
      activeAttemptsInFlight = (async () => {
        const response = await httpClient.get("/attempts/active");
        const { data, serverTime } = withServerTime(response);
        return {
          items: Array.isArray(data) ? data : [],
          serverTime,
        };
      })();

      return await activeAttemptsInFlight;
    } catch (error) {
      throw toApiError(error);
    } finally {
      activeAttemptsInFlight = null;
    }
  },

  startAttempt: async ({ test_id }) => {
    if (!test_id) {
      const inputError = new Error("test_id is required to start attempt");
      inputError.code = "INVALID_TEST_ID";
      inputError.status = 400;
      throw inputError;
    }

    const key = String(test_id);
    const inFlight = startAttemptInFlight.get(key);
    if (inFlight) {
      return await inFlight;
    }

    const request = (async () => {
      try {
        const clientSessionId = getOrCreateTestClientId();
        const response = await httpClient.post(
          `/tests/${test_id}/start`,
          { clientSessionId, agreedToInstructions: true },
          { headers: testSessionHeaders() }
        );
        return withServerTime(response).data;
      } catch (error) {
        const parsed = toApiError(error);

        if (parsed.status === 409) {
          try {
            const active = await studentApi.getActiveAttempts();
            const resumable = findResumableAttemptByTestId(active?.items, test_id);

            if (resumable) {
              const attemptId = normalizeSubmissionId(resumable);
              return await fetchAttemptSessionDirect(attemptId);
            }
          } catch {
            // Fall through to default error behavior.
          }
        }

        if (parsed.status === 429) {
          try {
            return await studentApi.getTestSession(test_id);
          } catch {
            // Fall through to default error behavior.
          }
        }

        if (parsed.status !== 404) {
          throw parsed;
        }

        try {
          const legacyResponse = await httpClient.post("/attempts/start", { test_id });
          return withServerTime(legacyResponse).data;
        } catch (legacyError) {
          throw toApiError(legacyError);
        }
      }
    })();

    startAttemptInFlight.set(key, request);

    try {
      return await request;
    } finally {
      if (startAttemptInFlight.get(key) === request) {
        startAttemptInFlight.delete(key);
      }
    }
  },

  getAttemptSession: async (attemptId) => {
    try {
      const activeAttempts = await studentApi.getActiveAttempts();
      const attempt = (activeAttempts?.items || []).find(
        (item) => String(item?.submissionId || item?.attempt_id || "") === String(attemptId)
      );

      if (attempt?.id || attempt?.test_id || attempt?.testId) {
        const testId = attempt.id || attempt.test_id || attempt.testId;
        let session = null;

        try {
          session = await studentApi.getTestSession(testId);
        } catch (error) {
          const parsed = error?.status ? error : toApiError(error);
          if (parsed.status === 409 && parsed.code === "ACTIVE_SESSION_EXISTS") {
            return await fetchAttemptSessionDirect(attemptId);
          }

          throw parsed;
        }

        return {
          ...session,
          attempt_id: attemptId,
          test_id: testId,
        };
      }

      return await fetchAttemptSessionDirect(attemptId);
    } catch (error) {
      throw error?.status ? error : toApiError(error);
    }
  },

  patchAttemptAnswers: async ({ attemptId, testId, changedAnswers }) => {
    try {
      if (!testId) {
        const inputError = new Error("testId is required to save answers");
        inputError.code = "INVALID_TEST_ID";
        inputError.status = 400;
        throw inputError;
      }

      const clientSessionId = getOrCreateTestClientId();
      const deduped = dedupeChangedAnswers(changedAnswers);
      const chunks = chunkArray(deduped, 3);

      for (const chunk of chunks) {
        await Promise.all(
          chunk.map((item) =>
            httpClient.post(`/tests/${testId}/answer`, {
            submissionId: attemptId,
            questionId: item.question_id,
            selectedOption: item.selected_option ?? null,
            selectedOptions: item.selected_options ?? null,
            answerText: item.answer_text ?? null,
            answerBoolean: typeof item.answer_boolean === "boolean" ? item.answer_boolean : null,
            markedForReview: Boolean(item.marked_for_review),
            clientSessionId,
            }, { headers: testSessionHeaders() })
          )
        );
      }

      return { saved: true };
    } catch (error) {
      const parsed = toApiError(error);
      if (parsed.status !== 404) {
        throw parsed;
      }

      try {
        const response = await httpClient.patch(`/attempts/${attemptId}/answers`, {
          answers: changedAnswers,
        });
        return response.data;
      } catch (legacyError) {
        throw toApiError(legacyError);
      }
    }
  },

  submitAttempt: async ({ attemptId, testId, reason }) => {
    if (!attemptId) {
      const inputError = new Error("attemptId is required to submit attempt");
      inputError.code = "INVALID_ATTEMPT_ID";
      inputError.status = 400;
      throw inputError;
    }

    const key = String(attemptId);
    const inFlight = submitAttemptInFlight.get(key);
    if (inFlight) {
      return await inFlight;
    }

    const request = (async () => {
      try {
        if (!testId) {
          throw new Error("Missing testId for /tests submit route");
        }

        const response = await httpClient.post(`/tests/${testId}/submit`, {
          submissionId: attemptId,
          reason,
          clientSessionId: getOrCreateTestClientId(),
        }, { headers: testSessionHeaders() });
        return response.data;
      } catch (error) {
        const parsed = toApiError(error);
        if (parsed.status !== 404 && parsed.status !== 400) {
          throw parsed;
        }

        try {
          const response = await httpClient.post(`/attempts/${attemptId}/submit`, { reason });
          return response.data;
        } catch (legacyError) {
          throw toApiError(legacyError);
        }
      }
    })();

    submitAttemptInFlight.set(key, request);

    try {
      return await request;
    } finally {
      if (submitAttemptInFlight.get(key) === request) {
        submitAttemptInFlight.delete(key);
      }
    }
  },

  advanceModule: async ({ attemptId, testId, fromModuleKey }) => {
    if (!attemptId) {
      const inputError = new Error("attemptId is required to advance module");
      inputError.code = "INVALID_ATTEMPT_ID";
      inputError.status = 400;
      throw inputError;
    }

    try {
      if (!testId) {
        throw new Error("Missing testId for /tests module advance route");
      }
      const response = await httpClient.post(
        `/tests/${testId}/module/advance`,
        {
          submissionId: attemptId,
          fromModuleKey,
          clientSessionId: getOrCreateTestClientId(),
        },
        { headers: testSessionHeaders() }
      );
      return response.data;
    } catch (error) {
      const parsed = toApiError(error);
      if (parsed.status !== 404 && parsed.status !== 400) {
        throw parsed;
      }
      try {
        const response = await httpClient.post(
          `/attempts/${attemptId}/module/advance`,
          { fromModuleKey, clientSessionId: getOrCreateTestClientId() },
          { headers: testSessionHeaders() }
        );
        return response.data;
      } catch (legacyError) {
        throw toApiError(legacyError);
      }
    }
  },

  heartbeatAttempt: async ({ attemptId, testId }) => {
    try {
      if (testId) {
        const response = await httpClient.post(
          `/tests/${testId}/heartbeat`,
          {
            submissionId: attemptId,
            clientSessionId: getOrCreateTestClientId(),
          },
          { headers: testSessionHeaders() }
        );
        return response.data;
      }

      const response = await httpClient.patch(
        `/attempts/${attemptId}/heartbeat`,
        {
          clientSessionId: getOrCreateTestClientId(),
        },
        { headers: testSessionHeaders() }
      );
      return response.data;
    } catch (error) {
      const parsed = toApiError(error);
      if (parsed.status !== 404) {
        throw parsed;
      }

      try {
        const response = await httpClient.patch(
          `/attempts/${attemptId}/heartbeat`,
          { clientSessionId: getOrCreateTestClientId() },
          { headers: testSessionHeaders() }
        );
        return response.data;
      } catch (legacyError) {
        throw toApiError(legacyError);
      }
    }
  },
 
  reportAttemptViolation: async ({ attemptId, testId, type, metadata }) => {
    const clientSessionId = getOrCreateTestClientId();
    const postPrimary = () =>
      testId
        ? httpClient.post(`/tests/${testId}/violation`, { submissionId: attemptId, type, metadata, clientSessionId }, { headers: testSessionHeaders() })
        : httpClient.post(`/attempts/${attemptId}/violations`, { type, metadata, clientSessionId }, { headers: testSessionHeaders() });
    const postLegacy = () =>
      httpClient.post(`/attempts/${attemptId}/violations`, { type, metadata, clientSessionId }, { headers: testSessionHeaders() });

    // Only transient failures are worth retrying: a network drop, a 5xx, or a
    // rate-limit. Terminal 4xx (already submitted, forbidden, validation) are not.
    const isTransient = (status) => !status || status === 429 || Number(status) >= 500;

    // Violations must not be silently dropped on a blip — unlike autosave and
    // heartbeat, a lost violation vanishes from the DB, reports, and integrity
    // analytics entirely. The server dedupes by (session, type, time window),
    // so a retry of one that actually landed is collapsed, never double-counted.
    const retryDelays = [800, 2000];
    let lastError = null;

    for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
      try {
        const response = await postPrimary();
        return response.data;
      } catch (error) {
        let parsed = toApiError(error);

        if (parsed.status === 404) {
          try {
            const response = await postLegacy();
            return response.data;
          } catch (legacyError) {
            parsed = toApiError(legacyError);
          }
        }

        lastError = parsed;
        if (!isTransient(parsed.status) || attempt === retryDelays.length) {
          throw parsed;
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]));
      }
    }

    throw lastError || new Error("Violation report failed");
  },

  getAttemptResult: async (attemptId) => {
    try {
      const response = await httpClient.get(`/results/${attemptId}`);
      return withServerTime(response).data;
    } catch (error) {
      const parsed = toApiError(error);
      if (parsed.status !== 404) {
        throw parsed;
      }

      try {
        const fallbackResponse = await httpClient.get(`/submission/${attemptId}`);
        return withServerTime(fallbackResponse).data;
      } catch (fallbackError) {
        throw toApiError(fallbackError);
      }
    }
  },

  getLeaderboard: async ({ view = "overall", test_id, department, page = 1, limit = 200 } = {}) => {
    const params = {
      view,
      page,
      limit,
    };

    if (test_id) {
      params.testId = test_id;
    }

    if (department) {
      params.departmentId = department;
    }

    try {
      const response = await httpClient.get("/leaderboard", { params });
      return withServerTime(response).data;
    } catch (error) {
      throw toApiError(error);
    }
  },

  getReports: async (filters = {}) => {
    const params = {
      view: filters?.view || "overall",
      test_id: filters?.test_id || undefined,
      date_from: filters?.date_from || undefined,
      date_to: filters?.date_to || undefined,
      topic: filters?.topic || undefined,
    };

    try {
      const response = await httpClient.get("/reports", { params });
      return withServerTime(response).data;
    } catch (error) {
      const parsed = toApiError(error);
      if (parsed.status !== 404) {
        throw parsed;
      }

      try {
        const fallbackResponse = await httpClient.get("/reports/overview", { params });
        return withServerTime(fallbackResponse).data;
      } catch (fallbackError) {
        throw toApiError(fallbackError);
      }
    }
  },

  exportReportsPdf: async (filters = {}) => {
    const payload = {
      view: filters?.view || "overall",
      test_id: filters?.test_id || undefined,
      date_from: filters?.date_from || undefined,
      date_to: filters?.date_to || undefined,
      topic: filters?.topic || undefined,
    };

    try {
      const response = await httpClient.post("/reports/export", payload, {
        responseType: "blob",
      });
      const contentType = response?.headers?.["content-type"] || "application/pdf";
      const blob = response.data instanceof Blob ? response.data : new Blob([response.data], { type: contentType });
      const url = URL.createObjectURL(blob);
      const filename = getFilenameFromDisposition(response?.headers?.["content-disposition"]);

      return {
        url,
        signed_url: url,
        signedUrl: url,
        filename,
        revoke: () => URL.revokeObjectURL(url),
      };
    } catch (error) {
      if (error?.response?.data instanceof Blob && String(error.response.data.type || "").includes("application/json")) {
        try {
          error.response.data = JSON.parse(await error.response.data.text());
        } catch {
          // Keep the original blob-shaped error if it cannot be parsed.
        }
      }
      throw toApiError(error);
    }
  },

  getUpcomingTests: async () => {
    try {
      const response = await httpClient.get("/tests/upcoming");
      const { data, serverTime } = withServerTime(response);
      return {
        items: Array.isArray(data) ? data : [],
        serverTime,
      };
    } catch (error) {
      throw toApiError(error);
    }
  },

  getTestAccessDetails: async (testId) => {
    try {
      const response = await httpClient.get(`/tests/${testId}/access`);
      return withServerTime(response).data;
    } catch (error) {
      throw toApiError(error);
    }
  },

  agreeToTestInstructions: async (testId) => {
    try {
      const response = await httpClient.post(`/tests/${testId}/agree`, { agreed: true });
      return withServerTime(response).data;
    } catch (error) {
      throw toApiError(error);
    }
  },

  getTestSession: async (testId) => {
    const key = String(testId || "");
    if (testSessionInFlight.has(key)) {
      return testSessionInFlight.get(key);
    }

    try {
      const request = (async () => {
        const response = await httpClient.get(`/tests/${testId}/session`, { headers: testSessionHeaders() });
        return response.data;
      })();

      testSessionInFlight.set(key, request);
      return await request;
    } catch (error) {
      throw toApiError(error);
    } finally {
      testSessionInFlight.delete(key);
    }
  },
};
