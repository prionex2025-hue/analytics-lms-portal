import { useCallback, useEffect, useMemo, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { clearSavedAnswerSnapshots, restoreDraftAnswers, saveAttemptAnswers, setSaveStatus } from "@/features/Students/testSlice";
import { getAccessToken } from "@/services/httpClient";
import { API_BASE_URL } from "@/services/runtimeConfig";

// Drafts live in localStorage (NOT sessionStorage) so unsaved answers survive
// a closed tab, a crashed browser, or a device restart — the student gets them
// back on resume. Cleared on successful save; stale drafts self-prune.
const localDraftKey = (attemptId) => `lms:attempt:draft:${attemptId}`;
const DRAFT_PREFIX = "lms:attempt:draft:";
const DRAFT_MAX_AGE_MS = 48 * 60 * 60 * 1000;

const readDraft = (attemptId) => {
  const parse = (raw) => {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed; // legacy shape
      if (parsed && Array.isArray(parsed.answers)) return parsed.answers;
      return null;
    } catch {
      return null;
    }
  };

  try {
    return (
      parse(localStorage.getItem(localDraftKey(attemptId))) ||
      // Migration fallback: drafts written by the previous sessionStorage version.
      parse(sessionStorage.getItem(localDraftKey(attemptId))) ||
      []
    );
  } catch {
    return [];
  }
};

const writeDraft = (attemptId, answers) => {
  try {
    localStorage.setItem(localDraftKey(attemptId), JSON.stringify({ v: 1, savedAt: Date.now(), answers }));
  } catch {
    // Storage unavailable — autosave still runs; only crash-recovery degrades.
  }
};

const removeDraft = (attemptId) => {
  try {
    localStorage.removeItem(localDraftKey(attemptId));
    sessionStorage.removeItem(localDraftKey(attemptId));
  } catch {
    // Ignore storage failures.
  }
};

const pruneStaleDrafts = () => {
  try {
    const now = Date.now();
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith(DRAFT_PREFIX)) continue;
      try {
        const parsed = JSON.parse(localStorage.getItem(key));
        const savedAt = Number(parsed?.savedAt || 0);
        if (!savedAt || now - savedAt > DRAFT_MAX_AGE_MS) {
          localStorage.removeItem(key);
        }
      } catch {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Ignore storage failures.
  }
};

const wait = (ms) => new Promise((resolve) => {
  window.setTimeout(resolve, ms);
});

export const useAttemptAutosave = () => {
  const dispatch = useDispatch();
  const debounceTimerRef = useRef(null);
  const isFlushingRef = useRef(false);
  const cooldownUntilRef = useRef(0);
  const restoredAttemptRef = useRef(null);

  const { attempt_id, test_id, answers, changed_answer_ids, question_order } = useSelector((state) => state.test);

  const changedPayload = useMemo(() => {
    return changed_answer_ids
      .map((questionId) => {
        const answer = answers[questionId] || {};

        return {
          question_id: questionId,
          selected_option: answer.selected_option ?? null,
          selected_options: Array.isArray(answer.selected_options) ? answer.selected_options : [],
          answer_boolean: typeof answer.answer_boolean === "boolean" ? answer.answer_boolean : null,
          answer_text: typeof answer.answer_text === "string" ? answer.answer_text : "",
          marked_for_review: Boolean(answer.marked_for_review),
        };
      });
  }, [answers, changed_answer_ids]);

  const changedPayloadRef = useRef(changedPayload);
  useEffect(() => {
    changedPayloadRef.current = changedPayload;
  }, [changedPayload]);

  const writeDraftToStorage = useCallback((payload) => {
    if (!attempt_id) return;
    writeDraft(attempt_id, payload);
  }, [attempt_id]);

  const flush = useCallback(async () => {
    if (!attempt_id || !test_id || !changedPayload.length || isFlushingRef.current) {
      return;
    }

    if (Date.now() < cooldownUntilRef.current) {
      return;
    }

    writeDraftToStorage(changedPayload);

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      dispatch(setSaveStatus("error"));
      return;
    }

    isFlushingRef.current = true;
    dispatch(setSaveStatus("saving"));

    const retryDelays = [1500, 3000, 6000];

    try {
      let lastError = null;

      for (let index = 0; index <= retryDelays.length; index += 1) {
        try {
          await dispatch(
            saveAttemptAnswers({
              attempt_id,
              test_id,
              changedAnswers: changedPayload,
            })
          ).unwrap();

          dispatch(clearSavedAnswerSnapshots(changedPayload));
          dispatch(setSaveStatus("saved"));
          removeDraft(attempt_id);
          isFlushingRef.current = false;
          return;
        } catch (error) {
          lastError = error;
          if (Number(error?.status) === 429) {
            const retryAfterSeconds = Number(error?.retryAfterSeconds || 0);
            const cooldownMs = retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 10_000;
            cooldownUntilRef.current = Date.now() + cooldownMs;
          }

          if (index < retryDelays.length) {
            await wait(retryDelays[index]);
          }
        }
      }

      throw lastError || new Error("Autosave failed");
    } catch {
      writeDraftToStorage(changedPayload);
      dispatch(setSaveStatus("error"));
      isFlushingRef.current = false;
    }
  }, [attempt_id, changedPayload, dispatch, test_id, writeDraftToStorage]);

  useEffect(() => {
    pruneStaleDrafts();
  }, []);

  useEffect(() => {
    if (!attempt_id || !test_id || restoredAttemptRef.current === attempt_id || question_order.length === 0) {
      return;
    }

    restoredAttemptRef.current = attempt_id;

    const parsed = readDraft(attempt_id);
    if (Array.isArray(parsed) && parsed.length > 0) {
      dispatch(restoreDraftAnswers(parsed));
    }
  }, [attempt_id, dispatch, question_order.length, test_id]);

  useEffect(() => {
    if (!attempt_id) {
      return undefined;
    }

    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
    }

    if (!changedPayload.length) {
      return undefined;
    }

    writeDraftToStorage(changedPayload);

    debounceTimerRef.current = window.setTimeout(() => {
      flush();
    }, 2000);

    return () => {
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, [attempt_id, changedPayload, changedPayload.length, flush, writeDraftToStorage]);

  useEffect(() => {
    if (!attempt_id || !test_id) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      if (changedPayload.length > 0) {
        flush();
      }
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [attempt_id, changedPayload.length, flush, test_id]);

  // Last-gasp flush: when the tab is being closed/hidden with unsaved answers,
  // fire keepalive requests that outlive the page. sendBeacon cannot carry the
  // Authorization header, so fetch({ keepalive }) is used instead. The draft in
  // localStorage remains the fallback if even this cannot complete.
  useEffect(() => {
    if (!attempt_id || !test_id) {
      return undefined;
    }

    const flushOnExit = () => {
      const pending = changedPayloadRef.current;
      const token = getAccessToken();
      if (!Array.isArray(pending) || pending.length === 0 || !token) return;

      writeDraft(attempt_id, pending);

      for (const item of pending.slice(0, 10)) {
        try {
          fetch(`${API_BASE_URL}/tests/${test_id}/answer`, {
            method: "POST",
            keepalive: true,
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              submissionId: attempt_id,
              questionId: item.question_id,
              selectedOption: item.selected_option ?? null,
              selectedOptions: item.selected_options ?? null,
              answerText: item.answer_text ?? null,
              answerBoolean: typeof item.answer_boolean === "boolean" ? item.answer_boolean : null,
              markedForReview: Boolean(item.marked_for_review),
            }),
          }).catch(() => {});
        } catch {
          // Keepalive unsupported or blocked — the localStorage draft covers it.
        }
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushOnExit();
    };

    window.addEventListener("pagehide", flushOnExit);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flushOnExit);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [attempt_id, test_id]);

  useEffect(() => {
    if (!attempt_id || !test_id) {
      return undefined;
    }

    const onlineHandler = async () => {
      const parsed = readDraft(attempt_id);

      if (Array.isArray(parsed) && parsed.length > 0) {
        await dispatch(
          saveAttemptAnswers({
            attempt_id,
            test_id,
            changedAnswers: parsed,
          })
        ).unwrap()
          .then(() => {
            dispatch(clearSavedAnswerSnapshots(parsed));
            removeDraft(attempt_id);
          })
          .catch(() => null);
      }

      flush();
    };

    window.addEventListener("online", onlineHandler);
    return () => window.removeEventListener("online", onlineHandler);
  }, [attempt_id, dispatch, flush, test_id]);

  return {
    flushPendingSaves: flush,
  };
};
