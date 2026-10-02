const models = require("../../models");
const { asyncHandler, ApiError } = require("../../utils/http");
const {
  completeSubmission,
  findAnswerForQuestion,
  getAnswerBoolean,
  getAnswerSelectedOption,
  getAnswerSelectedOptions,
  getAnswerText,
  isQuestionCorrect,
} = require("../../services/test.service");
const {
  canRevealCorrectAnswers,
  isTestCompleted,
  maskCorrectAnswer,
  resolveReviewMode,
} = require("../../services/student-review-policy.service");
const { REPORTABLE_SUBMISSION_STATUSES } = require("../../services/report-scope.service");
const { evaluationOrderBy } = require("../../services/attempt-evaluation.service");
const { renderHtmlToPdfBuffer } = require("../../services/report-pdf.service");
const { clampPercent, getSubmissionScorePercent, getTestTotalMarks } = require("../../utils/score");
const { PASS_THRESHOLD_PERCENT } = require("../../utils/stats");

const toPercent = (value) => clampPercent(value);

const getSubmissionTotalMarks = (submission) => getTestTotalMarks(submission?.test);

const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const formatDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatPercent = (value) => `${toPercent(value).toFixed(1)}%`;

const formatMarksPair = (obtained, total) => {
  const obtainedNum = Number(obtained);
  const totalNum = Number(total);
  if (!Number.isFinite(obtainedNum) || !Number.isFinite(totalNum) || totalNum <= 0) {
    return "--";
  }
  return `${obtainedNum}/${totalNum}`;
};

const formatDuration = (secondsInput) => {
  const totalSeconds = Math.max(0, Math.round(Number(secondsInput || 0)));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
};

const getStudentNumber = (student = {}) =>
  student.enrollNumber || student.enrollmentNumber || student.studentId || student.rollNo || "-";

const formatAnswerValue = (value) => {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "Not answered";
  if (value == null) return "Not answered";
  if (typeof value === "boolean") return value ? "True" : "False";
  const text = String(value).trim();
  return text || "Not answered";
};

const resolveStudentAnswerValue = (answer, type) => {
  if (!answer) return null;
  if (type === "MCQ_MULTI" || type === "MULTI_SELECT") return getAnswerSelectedOptions(answer);
  if (type === "TRUE_FALSE" || type === "BOOLEAN") return getAnswerBoolean(answer);
  return getAnswerSelectedOption(answer) ?? getAnswerText(answer) ?? getAnswerBoolean(answer);
};

const hasTestEnded = (test = {}) => {
  const endsAt = test?.endsAt || test?.endDate || test?.end_date || test?.ends_at;
  if (!endsAt) return false;
  const endsAtMs = new Date(endsAt).getTime();
  return Number.isFinite(endsAtMs) && endsAtMs <= Date.now();
};

const finalizeClosedStudentSubmissions = async ({ db, userId }) => {
  const staleSubmissions = await db.submission.findMany({
    where: {
      userId,
      status: "IN_PROGRESS",
    },
    include: {
      test: true,
    },
  });

  const closable = staleSubmissions.filter((submission) =>
    isTestCompleted(submission.test) || hasTestEnded(submission.test)
  );

  if (closable.length > 0) {
    await Promise.all(
      closable.map((submission) =>
        completeSubmission({ submissionId: submission.id, autoSubmitted: true })
      )
    );
  }

  return closable.length;
};

const buildStudentReportPayload = async ({ db, userId, filters = {} }) => {
  const view = String(filters.view || "overall").toLowerCase();
  const testId = String(filters.test_id || filters.testId || "").trim();

  await finalizeClosedStudentSubmissions({ db, userId });

  const baseWhere = {
    where: {
      userId,
      status: {
        in: REPORTABLE_SUBMISSION_STATUSES,
      },
    },
  };

  const submissions = await db.submission.findMany({
    ...baseWhere,
    include: {
      test: {
        include: {
          questions: {
            select: {
              marks: true,
            },
          },
        },
      },
    },
    orderBy: {
      submittedAt: "desc",
    },
  });

  const submissionsWithMetrics = submissions.map((item) => ({
    ...item,
    scorePercent: getSubmissionScorePercent(item),
    totalMarks: getSubmissionTotalMarks(item),
    obtainedMarks: Number(item.score || 0),
  }));

  const total = submissionsWithMetrics.length;
  const avgScorePercent = total > 0 ? submissionsWithMetrics.reduce((acc, item) => acc + Number(item.scorePercent || 0), 0) / total : 0;
  const bestAttempt = submissionsWithMetrics.reduce((best, current) => {
    if (!best) return current;
    return Number(current.scorePercent || 0) > Number(best.scorePercent || 0) ? current : best;
  }, null);

  const lineChart = submissionsWithMetrics
    .slice()
    .sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime())
    .map((item) => ({
      date: new Date(item.submittedAt).toLocaleDateString(),
      value: Number(item.scorePercent || 0),
      score: Number(item.scorePercent || 0),
      accuracy: Number(item.scorePercent || 0),
      obtainedMarks: Number(item.obtainedMarks || 0),
      totalMarks: Number(item.totalMarks || 0),
      label: item.test?.title || "Test",
    }));

  const answersForTopics = await db.answer.findMany({
    where: {
      submissionId: {
        in: submissions.map((item) => item.id),
      },
    },
    include: {
      question: {
        select: {
          id: true,
          topic: true,
          type: true,
          correctOption: true,
          correctText: true,
          correctBoolean: true,
          correctOptions: true,
        },
      },
      submission: {
        select: {
          test: {
            select: {
              subject: true,
            },
          },
        },
      },
    },
  });

  const topicAgg = new Map();
  answersForTopics.forEach((answer) => {
    const question = answer.question;
    if (!question) return;

    const topicName = question.topic || answer.submission?.test?.subject || "General";
    const key = String(topicName);

    const isCorrect = isQuestionCorrect(question, answer);

    const current = topicAgg.get(key) || { correct: 0, total: 0, topic: key };
    current.total += 1;
    if (isCorrect) current.correct += 1;
    topicAgg.set(key, current);
  });

  const topicPerformance = [...topicAgg.values()]
    .map((item) => ({
      topic: item.topic,
      value: item.total > 0 ? Number(((item.correct / item.total) * 100).toFixed(2)) : 0,
      score: item.total > 0 ? Number(((item.correct / item.total) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const payload = {
    overall: {
      totalTests: total,
      accuracy: toPercent(avgScorePercent),
      completion: 100,
      summary: {
        tests_taken: total,
        avg_score: toPercent(avgScorePercent),
        best_score: toPercent(bestAttempt?.scorePercent || 0),
        best_score_percent: toPercent(bestAttempt?.scorePercent || 0),
        best_score_obtained_marks: Number(bestAttempt?.obtainedMarks || 0),
        best_score_total_marks: Number(bestAttempt?.totalMarks || 0),
        missed_tests: 0,
      },
      line_chart: lineChart,
      topic_performance: topicPerformance,
    },
    testWise: submissionsWithMetrics.map((item) => ({
      submissionId: item.id,
      testId: item.testId,
      testName: item.test?.title || "Test",
      subject: item.test?.subject || "",
      endDate: item.test?.endsAt || null,
      testStatus: item.test?.status || null,
      test_status: item.test?.status || null,
      isTestCompleted: isTestCompleted(item.test),
      is_test_completed: isTestCompleted(item.test),
      score: Number(item.scorePercent || 0),
      scorePercent: Number(item.scorePercent || 0),
      accuracy: Number(item.scorePercent || 0),
      obtainedMarks: Number(item.obtainedMarks || 0),
      totalMarks: Number(item.totalMarks || 0),
      timeSpentSeconds: item.timeSpentSeconds,
      submittedAt: item.submittedAt,
    })),
    charts: {
      lineChart,
      radarChart: topicPerformance,
    },
  };

  if (view === "by_test") {
    if (!testId) {
      throw new ApiError(422, "test_id is required for by_test view", null, "TEST_ID_REQUIRED");
    }

    // Pick the official attempt per the test's recorded evaluationRule
    // (BEST_ATTEMPT → highest score; LAST_ATTEMPT → most recent).
    const testMeta = await db.test.findUnique({ where: { id: testId }, select: { evaluationRule: true } });

    const target = await db.submission.findFirst({
      where: {
        userId,
        testId,
        status: { in: REPORTABLE_SUBMISSION_STATUSES },
      },
      include: {
        test: {
          include: {
            questions: {
              orderBy: { order: "asc" },
            },
          },
        },
        answers: {
          include: {
            question: true,
          },
        },
      },
      orderBy: evaluationOrderBy(testMeta?.evaluationRule),
    });

    if (!target) {
      throw new ApiError(404, "No submitted attempt found for selected test", { test_id: testId }, "TEST_REPORT_NOT_FOUND");
    }

    const revealQuestionDetails = canRevealCorrectAnswers(target.test);
    const testCompleted = isTestCompleted(target.test);
    const reviewMode = revealQuestionDetails ? "show_all" : resolveReviewMode(target.test);
    const question_breakdown = (target.test?.questions || []).map((question) => {
      const answer = findAnswerForQuestion(target.answers, question);
      const type = String(question.type || "").toUpperCase();
      const isCorrect = isQuestionCorrect(question, answer);

      const studentAnswer = formatAnswerValue(resolveStudentAnswerValue(answer, type));
      const rawCorrectAnswer = formatAnswerValue(
        (type === "MCQ_MULTI" || type === "MULTI_SELECT")
          ? question.correctOptions
          : question.correctOption ?? question.correctText ?? question.correctBoolean
      );
      const correctAnswer = maskCorrectAnswer(rawCorrectAnswer, target.test);

      return {
        question_id: question.id,
        prompt: question.prompt,
        type: question.type,
        student_answer: studentAnswer,
        correct_answer: correctAnswer,
        marks: revealQuestionDetails ? (isCorrect ? Number(question.marks || 0) : 0) : null,
        total_marks: Number(question.marks || 0),
        is_correct: revealQuestionDetails ? Boolean(isCorrect) : null,
        topic: question.topic || target.test?.subject || "General",
        explanation_video_url: revealQuestionDetails ? question.explanationVideoUrl || null : null,
      };
    });

    const totalMarks = getTestTotalMarks(target.test);
    const obtainedMarks = Number(target.score || 0);
    const percentage = getSubmissionScorePercent(target);

    // MODULE_TEST: per-section performance derived from submission.moduleState,
    // matched to the fixed module set, plus overall aggregates.
    const moduleStateByKey = new Map(
      (Array.isArray(target.moduleState) ? target.moduleState : []).map((ms) => [ms.key, ms])
    );
    const isModuleFormat = String(target.test?.assessmentFormat || "").toUpperCase() === "MODULE_TEST";

    const questionsForModule = (mod) =>
      (target.test?.questions || []).filter(
        (question) => String(question.category || "").trim() === String(mod.category || "").trim()
      );

    const sections = isModuleFormat && moduleStateByKey.size > 0
      ? (Array.isArray(target.test?.modules) ? target.test.modules : [])
          .slice()
          .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
          .map((mod) => {
            const ms = moduleStateByKey.get(mod.key) || {};
            const moduleQuestions = questionsForModule(mod);
            const answeredCount = moduleQuestions.filter((question) => {
              const answer = findAnswerForQuestion(target.answers, question);
              return Boolean(
                answer &&
                (getAnswerSelectedOption(answer) != null ||
                  getAnswerBoolean(answer) != null ||
                  getAnswerText(answer) ||
                  (getAnswerSelectedOptions(answer) || []).length > 0)
              );
            }).length;
            return {
              key: mod.key,
              name: mod.name,
              order: mod.order,
              score: Number(ms.score || 0),
              max_score: Number(ms.maxScore || 0),
              percentage: Number(ms.percentage || 0),
              configured_duration_mins: ms.configuredDurationMins ?? Number(mod.durationMins || 0) ?? null,
              actual_time_seconds: Number(ms.timeTakenSeconds || 0),
              started_at: ms.startedAt || null,
              ended_at: ms.endedAt || null,
              status: ms.status || null,
              question_count: moduleQuestions.length,
              answered_count: answeredCount,
            };
          })
      : null;

    payload.by_test = {
      attempt_id: target.id,
      submission_id: target.id,
      total_marks: Number(totalMarks || 0),
      obtained_marks: obtainedMarks,
      percentage: toPercent(percentage),
      assessment_format: target.test?.assessmentFormat || "OPEN_TEST",
      overall_max_score: Number(target.overallMaxScore || 0),
      overall_percentage: Number(target.overallPercentage || percentage || 0),
      total_configured_duration_mins: Number(target.totalConfiguredDurationMins || 0),
      total_actual_time_seconds: Number(target.totalActualTimeSeconds || target.timeSpentSeconds || 0),
      sections,
      time_analytics: {
        total_time: Number(target.timeSpentSeconds || 0),
        avg_time_per_question:
          (target.test?.questions || []).length > 0
            ? Number((Number(target.timeSpentSeconds || 0) / (target.test?.questions || []).length).toFixed(2))
            : 0,
      },
      review_mode: reviewMode,
      test_status: target.test?.status || null,
      testStatus: target.test?.status || null,
      is_test_completed: testCompleted,
      isTestCompleted: testCompleted,
      can_review_answers: revealQuestionDetails,
      canReviewAnswers: revealQuestionDetails,
      test: {
        id: target.test?.id,
        title: target.test?.title,
        subject: target.test?.subject,
        status: target.test?.status,
        test_status: target.test?.status,
        is_completed: testCompleted,
        end_date: target.test?.endsAt,
      },
      questions: question_breakdown,
    };
  }

  return payload;
};

const getReport = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const payload = await buildStudentReportPayload({ db, userId: req.user.id, filters: req.query });

  res.status(200).json(payload);
});

const buildStudentReportHtml = ({ student, payload, filters, generatedAt }) => {
  const view = String(filters?.view || "overall").toLowerCase();
  const summary = payload?.overall?.summary || {};
  const attempts = Array.isArray(payload?.testWise) ? [...payload.testWise] : [];
  const byTest = payload?.by_test || payload?.byTest || null;
  const studentName = student?.fullName || student?.name || "Student";
  const selectedTestName = byTest?.test?.title || attempts.find((row) => String(row.testId || "") === String(filters?.test_id || filters?.testId || ""))?.testName || "Selected Test";

  const sortedAttempts = attempts.sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));
  const attemptRows = sortedAttempts.length > 0
    ? sortedAttempts.map((row) => {
        const scorePercent = Number(row.scorePercent ?? row.score ?? 0);
        return `
          <tr>
            <td>${escapeHtml(formatDate(row.submittedAt))}</td>
            <td>${escapeHtml(row.testName || "Test")}</td>
            <td>${escapeHtml(row.subject || "-")}</td>
            <td><strong>${escapeHtml(formatPercent(scorePercent))}</strong></td>
            <td>${escapeHtml(formatMarksPair(row.obtainedMarks, row.totalMarks))}</td>
            <td>${escapeHtml(formatDuration(row.timeSpentSeconds))}</td>
            <td><span class="badge ${scorePercent >= PASS_THRESHOLD_PERCENT ? "success" : "danger"}">${scorePercent >= PASS_THRESHOLD_PERCENT ? "PASS" : "FAIL"}</span></td>
            <td>${escapeHtml(row.testStatus || row.test_status || "-")}</td>
          </tr>
        `;
      }).join("")
    : `<tr><td colspan="8" class="muted">No submitted tests found.</td></tr>`;

  const questionRows = Array.isArray(byTest?.questions) && byTest.questions.length > 0
    ? byTest.questions.map((row, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(row.topic || "-")}</td>
          <td>${escapeHtml(row.type || "-")}</td>
          <td>${escapeHtml(row.student_answer ?? row.studentAnswer ?? "Not answered")}</td>
          <td>${escapeHtml(row.correct_answer ?? row.correctAnswer ?? "-")}</td>
          <td>${row.marks == null ? "-" : escapeHtml(`${row.marks}/${row.total_marks ?? 0}`)}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="6" class="muted">No question-level data available.</td></tr>`;

  const sectionPerformanceHtml = Array.isArray(byTest?.sections) && byTest.sections.length > 0
    ? `
      <section class="section">
        <h2>Section Performance</h2>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Module</th>
              <th>Score</th>
              <th>%</th>
              <th>Time Taken</th>
              <th>Configured</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${byTest.sections.map((sec) => `
              <tr>
                <td>${escapeHtml(String(sec.order ?? "-"))}</td>
                <td>${escapeHtml(sec.name || sec.key || "-")}</td>
                <td>${escapeHtml(formatMarksPair(sec.score, sec.max_score))}</td>
                <td>${escapeHtml(formatPercent(sec.percentage))}</td>
                <td>${escapeHtml(formatDuration(sec.actual_time_seconds))}</td>
                <td>${sec.configured_duration_mins == null ? "-" : escapeHtml(`${sec.configured_duration_mins} min`)}</td>
                <td>${escapeHtml(sec.status || "-")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </section>
    `
    : "";

const detailSection = view === "by_test" && byTest
    ? `
      <section class="section">
        <div class="section-heading">
          <h2>Selected Test Report</h2>
          <p>${escapeHtml(selectedTestName)}</p>
        </div>
        <div class="metrics-grid">
          <div class="metric-card"><div class="metric-value">${escapeHtml(formatMarksPair(byTest.obtained_marks, byTest.total_marks))}</div><div class="metric-label">Marks</div></div>
          <div class="metric-card"><div class="metric-value">${escapeHtml(formatPercent(byTest.percentage))}</div><div class="metric-label">Percentage</div></div>
          <div class="metric-card"><div class="metric-value">${escapeHtml(formatDuration(byTest.time_analytics?.total_time))}</div><div class="metric-label">Total Time</div></div>
        </div>
      </section>

      ${sectionPerformanceHtml}

      <section class="section">
        <h2>Question-Level Report</h2>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Topic</th>
              <th>Type</th>
              <th>Student Answer</th>
              <th>Correct Answer</th>
              <th>Marks</th>
            </tr>
          </thead>
          <tbody>${questionRows}</tbody>
        </table>
      </section>
    `
    : "";

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Student Report</title>
        <style>
          * { box-sizing: border-box; }
          body {
            margin: 0;
            background: #f8fafc;
            color: #0f172a;
            font-family: "Segoe UI", Arial, sans-serif;
            font-size: 12px;
          }
          .page { padding: 24px; }
          .hero {
            border-radius: 18px;
            padding: 22px;
            color: white;
            background: linear-gradient(135deg, #1d4ed8, #0f172a);
          }
          .hero h1 { margin: 0; font-size: 26px; }
          .hero p { margin: 7px 0 0; color: #dbeafe; }
          .meta {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px 20px;
            margin-top: 16px;
            color: #e0f2fe;
          }
          .meta strong { color: white; }
          .metrics-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 12px;
            margin-top: 14px;
          }
          .metric-card {
            border: 1px solid #e2e8f0;
            border-radius: 14px;
            background: #ffffff;
            padding: 14px;
          }
          .metric-value { font-size: 20px; font-weight: 750; }
          .metric-label {
            margin-top: 5px;
            color: #64748b;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: .06em;
            text-transform: uppercase;
          }
          .section {
            margin-top: 18px;
            border-radius: 16px;
            background: #ffffff;
            padding: 16px;
            border: 1px solid #e2e8f0;
            page-break-inside: avoid;
          }
          .section-heading {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            align-items: baseline;
          }
          h2 { margin: 0 0 12px; font-size: 16px; }
          .section-heading p { margin: 0; color: #64748b; font-weight: 600; }
          table { width: 100%; border-collapse: collapse; }
          th {
            text-align: left;
            padding: 10px;
            background: #f1f5f9;
            color: #334155;
            font-size: 11px;
          }
          td {
            padding: 10px;
            border-bottom: 1px solid #e2e8f0;
            vertical-align: top;
          }
          .badge {
            display: inline-block;
            padding: 3px 9px;
            border-radius: 999px;
            font-weight: 700;
            font-size: 10px;
          }
          .badge.success { background: #dcfce7; color: #166534; }
          .badge.danger { background: #fee2e2; color: #991b1b; }
          .muted { color: #64748b; text-align: center; }
          .footer {
            margin-top: 18px;
            color: #94a3b8;
            text-align: center;
            font-size: 11px;
          }
        </style>
      </head>
      <body>
        <main class="page">
          <section class="hero">
            <h1>${escapeHtml(view === "by_test" ? "Student Test Report" : "Student Performance Report")}</h1>
            <p>${escapeHtml(view === "by_test" ? selectedTestName : "Complete submitted test performance summary")}</p>
            <div class="meta">
              <div><strong>Student:</strong> ${escapeHtml(studentName)}</div>
              <div><strong>Student ID:</strong> ${escapeHtml(getStudentNumber(student))}</div>
              <div><strong>Department:</strong> ${escapeHtml(student?.department?.name || "-")}</div>
              <div><strong>Generated:</strong> ${escapeHtml(formatDateTime(generatedAt))}</div>
            </div>
          </section>

          <section class="section">
            <h2>Overall Summary</h2>
            <div class="metrics-grid">
              <div class="metric-card"><div class="metric-value">${escapeHtml(summary.tests_taken ?? 0)}</div><div class="metric-label">Tests Taken</div></div>
              <div class="metric-card"><div class="metric-value">${escapeHtml(formatPercent(summary.avg_score))}</div><div class="metric-label">Average Score</div></div>
              <div class="metric-card"><div class="metric-value">${escapeHtml(formatPercent(summary.best_score_percent ?? summary.best_score))}</div><div class="metric-label">Best Score</div></div>
              <div class="metric-card"><div class="metric-value">${escapeHtml(summary.missed_tests ?? 0)}</div><div class="metric-label">Missed Tests</div></div>
            </div>
          </section>

          ${detailSection}

          <section class="section">
            <div class="section-heading">
              <h2>Submitted Test Timeline</h2>
              <p>${sortedAttempts.length} records</p>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Test</th>
                  <th>Subject</th>
                  <th>Score</th>
                  <th>Marks</th>
                  <th>Time</th>
                  <th>Pass/Fail</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>${attemptRows}</tbody>
            </table>
          </section>

          <div class="footer">This PDF was generated by LMS Portal.</div>
        </main>
      </body>
    </html>
  `;
};

const exportReport = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const filters = req.body || {};
  const payload = await buildStudentReportPayload({ db, userId: req.user.id, filters });
  const generatedAt = new Date();
  const htmlContent = buildStudentReportHtml({
    student: req.user,
    payload,
    filters,
    generatedAt,
  });

  const pdfBuffer = await renderHtmlToPdfBuffer(htmlContent, {
    displayHeaderFooter: true,
    footerTemplate:
      '<div style="width:100%;font-size:10px;color:#94a3b8;padding:0 10mm;text-align:right;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
  });

  const filename = `student-report-${String(req.user.id || "me").slice(0, 8)}-${generatedAt.getTime()}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.status(200).send(pdfBuffer);
});

module.exports = { getReport, exportReport, buildStudentReportPayload };
