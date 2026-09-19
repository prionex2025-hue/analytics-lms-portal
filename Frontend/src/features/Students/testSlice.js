import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { studentApi } from "@/services/studentApi";
import { resolveIncomingTestConfig } from "@/lib/testConfig";

const normalizeQuestionType = (value) => {
  const type = String(value || "").toUpperCase();

  if (type === "MCQ_MULTI" || type === "MULTI_SELECT") return "MCQ_MULTI";
  if (type === "MCQ" || type === "MCQ_SINGLE" || type === "SINGLE_SELECT") return "MCQ_SINGLE";
  if (type === "TRUE_FALSE" || type === "BOOLEAN") return "TRUE_FALSE";
  if (type === "FILL_BLANK" || type === "FIB") return "FILL_BLANK";
  if (type === "PARAGRAPH" || type === "SUBJECTIVE") return "PARAGRAPH";

  return "MCQ_SINGLE";
};

const normalizeAnswersMap = (answersArrayOrObject) => {
  if (!answersArrayOrObject) return {};

  if (!Array.isArray(answersArrayOrObject) && typeof answersArrayOrObject === "object") {
    return answersArrayOrObject;
  }

  return (answersArrayOrObject || []).reduce((acc, item) => {
    const questionId = item?.questionId || item?.question_id;
    const selectedOptions = item?.selectedOptions || item?.selected_options;
    if (!questionId) {
      return acc;
    }

    acc[questionId] = {
      selected_option: item?.selectedOption ?? item?.selected_option ?? null,
      selected_options: Array.isArray(selectedOptions)
        ? [...selectedOptions]
        : [],
      answer_boolean: typeof (item?.answerBoolean ?? item?.answer_boolean) === "boolean"
        ? (item?.answerBoolean ?? item?.answer_boolean)
        : null,
      answer_text: item?.answerText ?? item?.answer_text ?? "",
      marked_for_review: Boolean(item?.markedForReview ?? item?.marked_for_review),
    };

    return acc;
  }, {});
};

const normalizeAnswerValue = (answer = {}) => ({
  selected_option: answer?.selected_option ?? null,
  selected_options: Array.isArray(answer?.selected_options) ? [...answer.selected_options] : [],
  answer_boolean: typeof answer?.answer_boolean === "boolean" ? answer.answer_boolean : null,
  answer_text: answer?.answer_text ?? "",
  marked_for_review: Boolean(answer?.marked_for_review),
});

const areAnswersEqual = (left = {}, right = {}) => {
  const normalizedLeft = normalizeAnswerValue(left);
  const normalizedRight = normalizeAnswerValue(right);

  return (
    normalizedLeft.selected_option === normalizedRight.selected_option &&
    normalizedLeft.answer_boolean === normalizedRight.answer_boolean &&
    normalizedLeft.answer_text === normalizedRight.answer_text &&
    normalizedLeft.marked_for_review === normalizedRight.marked_for_review &&
    normalizedLeft.selected_options.length === normalizedRight.selected_options.length &&
    normalizedLeft.selected_options.every((item, index) => item === normalizedRight.selected_options[index])
  );
};

const createDefaultViolationState = () => ({
  tab_switch: 0,
  copy: 0,
  paste: 0,
  window_blur: 0,
  right_click: 0,
  fullscreen_exit: 0,
  screenshot_attempt: 0,
  devtools_open: 0,
  total: 0,
});

const normalizeViolations = (payload) => {
  const base = createDefaultViolationState();

  if (!payload) {
    return base;
  }

  if (typeof payload === "object" && !Array.isArray(payload) && Number.isFinite(payload.total)) {
    return {
      ...base,
      ...payload,
      total: Number(payload.total || 0),
    };
  }

  if (!Array.isArray(payload)) {
    return base;
  }

  payload.forEach((item) => {
    const type = String(item?.type || "").toUpperCase();

    if (type.includes("TAB")) {
      base.tab_switch += 1;
    } else if (type.includes("COPY")) {
      base.copy += 1;
    } else if (type.includes("PASTE")) {
      base.paste += 1;
    } else if (type.includes("RIGHT")) {
      base.right_click += 1;
    } else if (type.includes("FULLSCREEN")) {
      base.fullscreen_exit += 1;
    } else if (type.includes("SCREENSHOT")) {
      base.screenshot_attempt += 1;
    } else if (type.includes("DEVTOOLS")) {
      base.devtools_open += 1;
    } else if (type.includes("BLUR")) {
      base.window_blur += 1;
    }

    base.total += 1;
  });

  return base;
};

const serializeApiError = (error) => ({
  message: error?.message || "Request failed",
  code: error?.code || "REQUEST_FAILED",
  status: Number(error?.status || 0) || null,
  details: error?.details || null,
});

const defaultProctoringConfig = {
  enabled: true,
  threshold: 3,
  fullscreen_required: false,
  tab_switch: "monitored",
  copy_paste: "monitored",
  window_blur: true,
  screenshot_detection: false,
  right_click_disabled: true,
  devtools_detection: true,
  auto_next_single: false,
  paragraph_word_limit: 250,
};

const buildStudentProctoringConfig = (payload, test) => {
  const resolved = resolveIncomingTestConfig(test || {});
  const source = {
    ...(test?.proctoring_config || {}),
    ...(payload?.proctoring_config || {}),
  };

  return {
    ...defaultProctoringConfig,
    enabled: Boolean(source.enabled ?? resolved.restrictions.enabled ?? defaultProctoringConfig.enabled),
    threshold: Number(
      source.threshold ??
      resolved.restrictions.violationThreshold ??
      defaultProctoringConfig.threshold
    ),
    fullscreen_required: Boolean(
      source.fullscreen_required ??
      resolved.restrictions.fullscreenRequired ??
      defaultProctoringConfig.fullscreen_required
    ),
    tab_switch: source.tab_switch || resolved.restrictions.tabSwitch || defaultProctoringConfig.tab_switch,
    copy_paste: source.copy_paste || resolved.restrictions.copyPaste || defaultProctoringConfig.copy_paste,
    window_blur: Boolean(
      source.window_blur ??
      resolved.restrictions.windowBlur ??
      defaultProctoringConfig.window_blur
    ),
    screenshot_detection: Boolean(
      source.screenshot_detection ??
      resolved.restrictions.screenshotDetection ??
      defaultProctoringConfig.screenshot_detection
    ),
    right_click_disabled: Boolean(
      source.right_click_disabled ??
      resolved.restrictions.rightClickDisabled ??
      defaultProctoringConfig.right_click_disabled
    ),
    devtools_detection: Boolean(
      source.devtools_detection ??
      resolved.restrictions.devtoolsDetection ??
      defaultProctoringConfig.devtools_detection
    ),
    auto_next_single: Boolean(
      source.auto_next_single ??
      resolved.restrictions.autoNextSingle ??
      defaultProctoringConfig.auto_next_single
    ),
    paragraph_word_limit: Number(
      source.paragraph_word_limit ??
      resolved.restrictions.paragraphWordLimit ??
      defaultProctoringConfig.paragraph_word_limit
    ),
  };
};

const deriveServerEndTime = ({ serverEndTime, submission, test }) => {
  if (serverEndTime) {
    const parsed = new Date(serverEndTime).getTime();
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  const startedAt = submission?.startedAt || submission?.started_at;
  const durationMins = Number(test?.durationMins || test?.duration_mins || 0);
  const startedAtMs = startedAt ? new Date(startedAt).getTime() : 0;

  if (startedAtMs > 0 && durationMins > 0) {
    return startedAtMs + durationMins * 60 * 1000;
  }

  return Date.now() + 30 * 60 * 1000;
};

const normalizeAttemptPayload = (payload) => {
  const submission = payload?.submission || payload;
  const test = payload?.test || payload?.attempt?.test || submission?.test || null;
  const attemptId = payload?.attempt_id || payload?.attemptId || submission?.id || payload?.id || null;
  const testId = payload?.test_id || payload?.testId || test?.id || submission?.testId || null;
  const rawQuestions = payload?.questions || test?.questions || payload?.attempt?.questions || [];
  const normalizedQuestions = {};

  const questionList = Array.isArray(rawQuestions)
    ? rawQuestions
    : rawQuestions && typeof rawQuestions === "object"
      ? Object.values(rawQuestions)
      : [];

  questionList.forEach((question, index) => {
    const qid = question?.id || question?._id || question?.questionId || question?.question_id;
    if (!qid) {
      return;
    }

    normalizedQuestions[qid] = {
      id: qid,
      prompt: question?.prompt || question?.title || "Question",
      type: normalizeQuestionType(question?.type),
      options: Array.isArray(question?.options) ? question.options : [],
      order: Number(question?.order || index + 1),
      word_limit: Number(question?.word_limit || question?.wordLimit || 0) || null,
    };
  });

  const questionOrder = Array.isArray(payload?.question_order)
    ? payload.question_order
    : Object.values(normalizedQuestions)
        .sort((a, b) => a.order - b.order)
        .map((question) => question.id);

  const answers = normalizeAnswersMap(payload?.answers || submission?.answers);
  const markedForReview = Object.entries(answers)
    .filter(([, answer]) => Boolean(answer?.marked_for_review))
    .map(([questionId]) => questionId);

  const violations = normalizeViolations(payload?.violations || submission?.violations);
  const serverEndTime = deriveServerEndTime({
    serverEndTime: payload?.server_end_time || payload?.serverEndTime,
    submission,
    test,
  });

  // Clock-skew offset: the server sends its own "now" with the payload, so the
  // countdown can run against SERVER time instead of trusting the student's
  // device clock (a fast local clock would otherwise end the exam early, a
  // slow one would show phantom minutes).
  const serverNow = Number(payload?.serverTime || payload?.server_time || 0);
  const clockOffsetMs = Number.isFinite(serverNow) && serverNow > 0 ? serverNow - Date.now() : 0;

  const assessmentFormat = String(payload?.assessment_format || test?.assessment_format || "OPEN_TEST").toUpperCase();
  const serverModuleEndTime = payload?.server_module_end_time
    ? new Date(payload.server_module_end_time).getTime()
    : null;

  return {
    attempt_id: attemptId,
    test_id: testId,
    question_order: questionOrder,
    questions: normalizedQuestions,
    answers,
    marked_for_review: markedForReview,
    current_question_index: 0,
    server_end_time: serverEndTime,
    clock_offset_ms: clockOffsetMs,
    violations,
    proctoring_config: buildStudentProctoringConfig(payload, test),
    assessment_format: assessmentFormat,
    modules: Array.isArray(payload?.modules) ? payload.modules : [],
    current_module: payload?.current_module || null,
    server_module_end_time: Number.isFinite(serverModuleEndTime) ? serverModuleEndTime : null,
  };
};

export const fetchMyTests = createAsyncThunk("test/list", async () => {
  const [ongoing, upcoming] = await Promise.all([studentApi.getActiveAttempts(), studentApi.getUpcomingTests()]);
  return {
    ongoing: ongoing?.items || [],
    upcoming: upcoming?.items || [],
  };
});

export const startAttempt = createAsyncThunk("test/startAttempt", async ({ test_id }) => {
  const payload = await studentApi.startAttempt({ test_id });
  return normalizeAttemptPayload(payload);
});

export const loadAttempt = createAsyncThunk("test/loadAttempt", async ({ attempt_id }) => {
  const payload = await studentApi.getAttemptSession(attempt_id);
  return normalizeAttemptPayload(payload);
});

export const saveAttemptAnswers = createAsyncThunk(
  "test/saveAttemptAnswers",
  async ({ attempt_id, test_id, changedAnswers }, { rejectWithValue }) => {
    try {
      return await studentApi.patchAttemptAnswers({ attemptId: attempt_id, testId: test_id, changedAnswers });
    } catch (error) {
      return rejectWithValue(serializeApiError(error));
    }
  }
);

export const reportAttemptViolation = createAsyncThunk(
  "test/reportAttemptViolation",
  async ({ attempt_id, test_id, type, metadata }, { rejectWithValue }) => {
    try {
      return await studentApi.reportAttemptViolation({ attemptId: attempt_id, testId: test_id, type, metadata });
    } catch (error) {
      return rejectWithValue(serializeApiError(error));
    }
  }
);

export const heartbeatAttempt = createAsyncThunk(
  "test/heartbeatAttempt",
  async ({ attempt_id, test_id }, { rejectWithValue }) => {
    try {
      return await studentApi.heartbeatAttempt({ attemptId: attempt_id, testId: test_id });
    } catch (error) {
      return rejectWithValue(serializeApiError(error));
    }
  }
);

export const submitAttempt = createAsyncThunk(
  "test/submitAttempt",
  async ({ attempt_id, test_id, reason }, { rejectWithValue }) => {
    try {
      return await studentApi.submitAttempt({ attemptId: attempt_id, testId: test_id, reason });
    } catch (error) {
      return rejectWithValue(serializeApiError(error));
    }
  }
);

// MODULE_TEST: submit the current module and move to the next (or complete).
export const advanceModule = createAsyncThunk(
  "test/advanceModule",
  async ({ attempt_id, test_id, fromModuleKey }, { rejectWithValue }) => {
    try {
      const payload = await studentApi.advanceModule({ attemptId: attempt_id, testId: test_id, fromModuleKey });
      return {
        completed: Boolean(payload?.completed),
        normalized: payload?.completed ? null : normalizeAttemptPayload(payload),
      };
    } catch (error) {
      return rejectWithValue(serializeApiError(error));
    }
  }
);

const initialState = {
  ongoing: [],
  upcoming: [],
  testsLoading: false,

  attempt_id: null,
  test_id: null,
  question_order: [],
  questions: {},
  answers: {},
  changed_answer_ids: [],
  current_question_index: 0,
  marked_for_review: [],
  server_end_time: null,
  clock_offset_ms: 0,
  violations: createDefaultViolationState(),
  proctoring_config: defaultProctoringConfig,
  assessment_format: "OPEN_TEST",
  modules: [],
  current_module: null,
  server_module_end_time: null,
  advance_status: "idle",
  save_status: "idle",
  submit_status: "idle",
  start_status: "idle",
  load_status: "idle",
  heartbeat_status: "idle",
  last_error: null,
  pending_submit: null,
};

const testSlice = createSlice({
  name: "test",
  initialState,
  reducers: {
    setCurrentQuestionIndex: (state, action) => {
      state.current_question_index = Math.max(0, Number(action.payload || 0));
    },
    setAnswer: (state, action) => {
      const { question_id, answer } = action.payload;
      if (!question_id) {
        return;
      }

      state.answers[question_id] = normalizeAnswerValue(answer);

      if (!state.changed_answer_ids.includes(question_id)) {
        state.changed_answer_ids.push(question_id);
      }

      if (state.answers[question_id]?.marked_for_review) {
        if (!state.marked_for_review.includes(question_id)) {
          state.marked_for_review.push(question_id);
        }
      } else {
        state.marked_for_review = state.marked_for_review.filter((item) => item !== question_id);
      }
    },
    toggleMarkedForReview: (state, action) => {
      const questionId = action.payload;
      if (!questionId) {
        return;
      }

      const current = state.answers[questionId] || {
        selected_option: null,
        selected_options: [],
        answer_boolean: null,
        answer_text: "",
        marked_for_review: false,
      };

      const nextMarked = !current.marked_for_review;
      state.answers[questionId] = {
        ...current,
        marked_for_review: nextMarked,
      };

      if (!state.changed_answer_ids.includes(questionId)) {
        state.changed_answer_ids.push(questionId);
      }

      if (nextMarked) {
        if (!state.marked_for_review.includes(questionId)) {
          state.marked_for_review.push(questionId);
        }
      } else {
        state.marked_for_review = state.marked_for_review.filter((item) => item !== questionId);
      }
    },
    clearAnswer: (state, action) => {
      const questionId = action.payload;
      if (!questionId) {
        return;
      }

      delete state.answers[questionId];

      if (!state.changed_answer_ids.includes(questionId)) {
        state.changed_answer_ids.push(questionId);
      }

      state.marked_for_review = state.marked_for_review.filter((item) => item !== questionId);
    },
    clearChangedAnswerIds: (state, action) => {
      const ids = action.payload || [];
      const set = new Set(ids);
      state.changed_answer_ids = state.changed_answer_ids.filter((id) => !set.has(id));
    },
    clearSavedAnswerSnapshots: (state, action) => {
      const snapshots = Array.isArray(action.payload) ? action.payload : [];
      const savedIds = new Set();

      snapshots.forEach((snapshot) => {
        const questionId = snapshot?.question_id;
        if (!questionId) {
          return;
        }

        if (areAnswersEqual(state.answers[questionId], snapshot)) {
          savedIds.add(questionId);
        }
      });

      state.changed_answer_ids = state.changed_answer_ids.filter((id) => !savedIds.has(id));
    },
    restoreDraftAnswers: (state, action) => {
      const answers = Array.isArray(action.payload) ? action.payload : [];

      answers.forEach((item) => {
        const questionId = item?.question_id;
        if (!questionId || !state.questions[questionId]) {
          return;
        }

        const restoredAnswer = normalizeAnswerValue(item);
        state.answers[questionId] = restoredAnswer;

        if (!state.changed_answer_ids.includes(questionId)) {
          state.changed_answer_ids.push(questionId);
        }

        if (restoredAnswer.marked_for_review) {
          if (!state.marked_for_review.includes(questionId)) {
            state.marked_for_review.push(questionId);
          }
        } else {
          state.marked_for_review = state.marked_for_review.filter((id) => id !== questionId);
        }
      });

      if (answers.length > 0 && state.save_status !== "saving") {
        state.save_status = "error";
      }
    },
    incrementViolationCounter: (state, action) => {
      const type = String(action.payload || "").toLowerCase();
      if (type === "tab_switch") state.violations.tab_switch += 1;
      if (type === "copy") state.violations.copy += 1;
      if (type === "paste") state.violations.paste += 1;
      if (type === "window_blur") state.violations.window_blur += 1;
      if (type === "right_click") state.violations.right_click += 1;
      if (type === "fullscreen_exit") state.violations.fullscreen_exit += 1;
      if (type === "screenshot_attempt") state.violations.screenshot_attempt += 1;
      if (type === "devtools_open") state.violations.devtools_open += 1;
    },
    setSaveStatus: (state, action) => {
      state.save_status = action.payload;
    },
    setSubmitStatus: (state, action) => {
      state.submit_status = action.payload;
    },
    setPendingSubmit: (state, action) => {
      state.pending_submit = action.payload;
    },
    resetAttemptState: (state) => {
      state.attempt_id = null;
      state.test_id = null;
      state.question_order = [];
      state.questions = {};
      state.answers = {};
      state.changed_answer_ids = [];
      state.current_question_index = 0;
      state.marked_for_review = [];
      state.server_end_time = null;
      state.clock_offset_ms = 0;
      state.violations = createDefaultViolationState();
      state.proctoring_config = defaultProctoringConfig;
      state.assessment_format = "OPEN_TEST";
      state.modules = [];
      state.current_module = null;
      state.server_module_end_time = null;
      state.advance_status = "idle";
      state.save_status = "idle";
      state.submit_status = "idle";
      state.start_status = "idle";
      state.load_status = "idle";
      state.heartbeat_status = "idle";
      state.last_error = null;
      state.pending_submit = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchMyTests.pending, (state) => {
        state.testsLoading = true;
      })
      .addCase(fetchMyTests.fulfilled, (state, action) => {
        state.testsLoading = false;
        state.ongoing = action.payload.ongoing;
        state.upcoming = action.payload.upcoming;
      })
      .addCase(fetchMyTests.rejected, (state) => {
        state.testsLoading = false;
      })
      .addCase(startAttempt.pending, (state) => {
        state.start_status = "loading";
        state.last_error = null;
      })
      .addCase(startAttempt.fulfilled, (state, action) => {
        state.start_status = "ready";
        Object.assign(state, action.payload);
      })
      .addCase(startAttempt.rejected, (state, action) => {
        state.start_status = "failed";
        state.last_error = action.error?.message || "Failed to start test";
      })
      .addCase(loadAttempt.pending, (state) => {
        state.load_status = "loading";
        state.last_error = null;
      })
      .addCase(loadAttempt.fulfilled, (state, action) => {
        state.load_status = "ready";
        Object.assign(state, action.payload);
      })
      .addCase(loadAttempt.rejected, (state, action) => {
        state.load_status = "failed";
        state.last_error = action.error?.message || "Failed to load attempt";
      })
      .addCase(saveAttemptAnswers.pending, (state) => {
        state.save_status = "saving";
      })
      .addCase(saveAttemptAnswers.fulfilled, (state) => {
        state.save_status = "saved";
      })
      .addCase(saveAttemptAnswers.rejected, (state) => {
        state.save_status = "error";
      })
      .addCase(submitAttempt.pending, (state) => {
        state.submit_status = "submitting";
      })
      .addCase(submitAttempt.fulfilled, (state) => {
        state.submit_status = "submitted";
      })
      .addCase(submitAttempt.rejected, (state) => {
        state.submit_status = "error";
      })
      .addCase(advanceModule.pending, (state) => {
        state.advance_status = "advancing";
        state.last_error = null;
      })
      .addCase(advanceModule.fulfilled, (state, action) => {
        state.advance_status = "idle";
        if (action.payload?.completed) {
          state.submit_status = "submitted";
          return;
        }
        if (action.payload?.normalized) {
          Object.assign(state, action.payload.normalized);
          // New module -> fresh question set and timer; drop stale local state.
          state.current_question_index = 0;
          state.changed_answer_ids = [];
          state.marked_for_review = [];
          state.save_status = "idle";
        }
      })
      .addCase(advanceModule.rejected, (state, action) => {
        state.advance_status = "error";
        state.last_error = action.payload?.message || action.error?.message || "Failed to advance module";
      })
      .addCase(reportAttemptViolation.fulfilled, (state, action) => {
        const count = Number(action.payload?.violationCount);
        if (Number.isFinite(count) && count >= 0) {
          state.violations.total = count;
        }
      })
      .addCase(heartbeatAttempt.pending, (state) => {
        state.heartbeat_status = "sending";
      })
      .addCase(heartbeatAttempt.fulfilled, (state) => {
        state.heartbeat_status = "ok";
      })
      .addCase(heartbeatAttempt.rejected, (state) => {
        state.heartbeat_status = "error";
      });
  },
});

export const {
  setCurrentQuestionIndex,
  setAnswer,
  toggleMarkedForReview,
  clearAnswer,
  clearChangedAnswerIds,
  clearSavedAnswerSnapshots,
  restoreDraftAnswers,
  incrementViolationCounter,
  setSaveStatus,
  setSubmitStatus,
  setPendingSubmit,
  resetAttemptState,
} = testSlice.actions;

export default testSlice.reducer;
