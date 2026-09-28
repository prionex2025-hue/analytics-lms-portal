const PASS_THRESHOLD_PERCENT = 40;
const PLACEMENT_READY_PERCENT = 60;
const { clampPercent } = require("../utils/score");
const {
  REPORTABLE_SUBMISSION_STATUSES,
  buildStudentLifecycleWhere,
  buildReportScopeMetadata,
} = require("./report-scope.service");
const { computeItemAnalysis } = require("./item-analysis.service");
const { isQuestionCorrect } = require("./test.service");
const { aggregateModulePerformance } = require("./report-analytics-aggregation.service");

// Above this many attempts we skip per-question item analysis in the report to
// avoid loading an unbounded number of answer rows in the worker.
const MAX_QUESTION_ANALYTICS_SUBMISSIONS = 8000;

const toNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

const toPercent = (value) => clampPercent(value);

const round1 = (value) => Math.round(toNumber(value) * 10) / 10;

const normalizeSubject = (value) => String(value || "General").trim() || "General";
const getStudentNumber = (student = {}) => student.enrollNumber || student.enrollmentNumber || student.studentId || "-";

const normId = (value) => String(value || "").trim();
const uniqIds = (values = []) => [...new Set((Array.isArray(values) ? values : []).map(normId).filter(Boolean))];
const getTestBatchIds = (test = {}) =>
  uniqIds([test.batchId, ...(Array.isArray(test.batchAssignments) ? test.batchAssignments.map((assignment) => assignment.batchId) : [])]);
const getStudentBatchIds = (student = {}) =>
  uniqIds([student.batchId, ...(Array.isArray(student.batchIds) ? student.batchIds : [])]);
const normalizeYearList = (values) =>
  Array.isArray(values)
    ? [...new Set(values.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 1 && value <= 4))]
    : [];

// Mirrors the analytics controller's rule: which students a test actually
// "registers", honouring its assignment method (everyone / department_wise /
// batch_wise), assigned years, and legacy (null-method) tests.
const isStudentAssignedToTest = (student = {}, test = null) => {
  if (!test?.id) return true;

  const method = String(test.assignmentMethod || "").trim().toLowerCase();
  const studentDepartmentId = normId(student.departmentId);
  const studentBatchIds = getStudentBatchIds(student);
  const testYears = normalizeYearList(test.years);

  if (testYears.length > 0 && !testYears.includes(Number(student.year))) {
    return false;
  }

  if (method === "everyone") return true;

  if (method === "department_wise") {
    const departmentIds = uniqIds([test.departmentId, ...(Array.isArray(test.assignedTo) ? test.assignedTo : [])]);
    return departmentIds.length > 0 && departmentIds.includes(studentDepartmentId);
  }

  if (method === "batch_wise") {
    const batchIds = getTestBatchIds(test);
    return batchIds.length > 0 && studentBatchIds.some((id) => batchIds.includes(id));
  }

  // Legacy tests with no assignment method: match by department or batch, else
  // fall back to visible-to-all.
  const legacyDepartmentIds = uniqIds([test.departmentId, ...(Array.isArray(test.assignedTo) ? test.assignedTo : [])]);
  const legacyBatchIds = getTestBatchIds(test);
  return (
    (legacyDepartmentIds.length > 0 && legacyDepartmentIds.includes(studentDepartmentId))
    || (legacyBatchIds.length > 0 && studentBatchIds.some((id) => legacyBatchIds.includes(id)))
    || (legacyDepartmentIds.length === 0 && legacyBatchIds.length === 0)
  );
};

const formatScorePercent = (score, totalMarks) => {
  const safeTotal = toNumber(totalMarks);
  const safeScore = toNumber(score);
  if (!safeTotal) return clampPercent(safeScore);
  return toPercent((safeScore / safeTotal) * 100);
};

const buildSubmissionDateFilter = (filters = {}) => {
  const range = {};
  if (filters.dateFrom) {
    range.gte = new Date(filters.dateFrom);
  }
  if (filters.dateTo) {
    range.lte = new Date(filters.dateTo);
  }
  return Object.keys(range).length > 0 ? range : null;
};

const resolveAcademicYear = ({ filters, batch }) => {
  if (filters.academicYear) return filters.academicYear;
  return batch?.academicYear || "-";
};

const resolveSemester = (filters = {}) => filters.semester || "-";

const resolveRemarks = (filters = {}) => filters.remarks || "";

const resolveLogoUrl = (filters = {}) => filters.logoUrl || "";

const resolveStudentYear = (student) => {
  const directYear = student?.year;
  if (directYear != null && directYear !== "") return directYear;
  return student?.batch?.academicYear || student?.batch?.year || "-";
};

const getSubjectStatus = (avgScore) => {
  if (avgScore < 50) return "Needs Attention";
  if (avgScore < 70) return "Moderate";
  return "Good";
};

const secondsToMinutes = (seconds) => Math.round(toNumber(seconds) / 60);

// Human-readable outcome for an in-progress / non-submitted attempt.
const describeIncompleteStatus = (status) => {
  const raw = String(status || "").toUpperCase();
  if (raw === "IN_PROGRESS") return "Opened / Not submitted";
  if (raw === "AUTO_SUBMITTED") return "Auto submitted";
  return raw ? raw.replace(/_/g, " ") : "Incomplete";
};

// Standard submission include shape so admin and super-admin fetch exactly the
// fields aggregateInstitutionReport() consumes.
const REPORT_SUBMISSION_INCLUDE = {
  user: {
    select: {
      id: true,
      fullName: true,
      email: true,
      studentId: true,
      enrollNumber: true,
      enrollmentNumber: true,
      year: true,
      departmentId: true,
      batch: { select: { name: true, year: true, academicYear: true } },
    },
  },
  test: { select: { id: true, title: true, subject: true, totalMarks: true } },
  violations: { select: { type: true } },
};

const REPORT_INCOMPLETE_INCLUDE = {
  user: {
    select: {
      id: true,
      fullName: true,
      studentId: true,
      enrollNumber: true,
      enrollmentNumber: true,
      departmentId: true,
    },
  },
};

const buildTestScope = async ({ db, collegeId, departmentId, batchIds, testId, testIds = [] }) => {
  const orFilters = [];

  orFilters.push({ assignmentMethod: "everyone" });

  if (departmentId) {
    orFilters.push({ assignmentMethod: "department_wise", departmentId });
    orFilters.push({ assignmentMethod: "department_wise", assignedTo: { in: [departmentId] } });
    orFilters.push({ assignmentMethod: null, departmentId });
    orFilters.push({ assignmentMethod: null, assignedTo: { in: [departmentId] } });
  }

  if (batchIds.length > 0) {
    orFilters.push({ assignmentMethod: "batch_wise", batchId: { in: batchIds } });
    orFilters.push({ assignmentMethod: "batch_wise", batchAssignments: { some: { batchId: { in: batchIds } } } });
    orFilters.push({ assignmentMethod: "department_wise", departmentId: null, batchId: { in: batchIds } });
    orFilters.push({ assignmentMethod: "department_wise", departmentId: null, batchAssignments: { some: { batchId: { in: batchIds } } } });
    orFilters.push({ assignmentMethod: null, batchId: { in: batchIds } });
    orFilters.push({ assignmentMethod: null, batchAssignments: { some: { batchId: { in: batchIds } } } });
  }

  if (orFilters.length === 0) return [];

  const onlyIds = uniqIds([...(Array.isArray(testIds) ? testIds : []), testId]);
  const testWhere = {
    collegeId,
    OR: orFilters,
    ...(onlyIds.length === 1 ? { id: onlyIds[0] } : onlyIds.length > 1 ? { id: { in: onlyIds } } : {}),
  };

  return db.test.findMany({
    where: testWhere,
    select: {
      id: true, title: true, subject: true, totalMarks: true, durationMins: true, startsAt: true, endsAt: true,
      assignmentMethod: true, assignedTo: true, departmentId: true, batchId: true, years: true,
      assessmentFormat: true, modules: true,
      batchAssignments: { select: { batchId: true } },
    },
  });
};

// Build a short deterministic report id from the job so every regenerated PDF
// for the same job carries the same reference number.
const buildReportId = (job) => {
  const created = job?.createdAt ? new Date(job.createdAt) : new Date();
  const year = Number.isFinite(created.getTime()) ? created.getFullYear() : new Date().getFullYear();
  const tail = String(job?.id || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-6)
    .toUpperCase()
    .padStart(6, "0");
  return `AED-${year}-${tail}`;
};

/**
 * Per-question item analysis for a single selected test. Loads the test's
 * questions and every answer for the scoped submissions, resolves correctness,
 * and runs classical test-theory item analysis. Returns null when there is no
 * single test in scope (an "All Tests" report has no per-question view) or the
 * attempt count is too large to itemise safely.
 */
const buildQuestionAnalytics = async ({ db, test, submissions }) => {
  if (!test?.id || !Array.isArray(submissions) || submissions.length === 0) return null;
  if (submissions.length > MAX_QUESTION_ANALYTICS_SUBMISSIONS) return null;

  const questions = await db.question.findMany({
    where: { testId: test.id },
    select: {
      id: true, order: true, prompt: true, type: true, options: true,
      correctOption: true, correctOptions: true, correctBoolean: true, correctText: true, marks: true,
    },
  });
  if (!questions.length) return null;

  const questionById = new Map(questions.map((question) => [String(question.id), question]));
  const submissionIds = submissions.map((submission) => String(submission.id));
  const answerRows = await db.answer.findMany({
    where: { submissionId: { in: submissionIds } },
    select: {
      submissionId: true, questionId: true, selectedOption: true, selectedOptions: true,
      selectedBoolean: true, selectedText: true, answerBoolean: true, answerText: true,
      isCorrect: true, markedForReview: true, timeSpentSeconds: true,
    },
  });

  // Persisted isCorrect can be null on older rows, so resolve it here and keep
  // computeItemAnalysis pure.
  const answers = answerRows.map((answer) => {
    const question = questionById.get(String(answer.questionId));
    const resolved = typeof answer.isCorrect === "boolean"
      ? answer.isCorrect
      : question ? Boolean(isQuestionCorrect(question, answer)) : false;
    return { ...answer, isCorrect: resolved };
  });

  const analysisSubmissions = submissions.map((submission) => ({
    id: String(submission.id),
    scorePercent: formatScorePercent(submission.score, test.totalMarks || 0),
  }));

  const { items, summary } = computeItemAnalysis({ questions, submissions: analysisSubmissions, answers });

  return {
    summary: {
      totalQuestions: summary.totalQuestions,
      analysedQuestions: summary.analysedQuestions,
      flaggedQuestions: summary.flaggedQuestions,
      averageDifficulty: summary.averageDifficulty,
      averageDiscrimination: summary.averageDiscrimination,
    },
    items: items.map((item) => ({
      order: item.order,
      prompt: item.prompt,
      attempts: item.attempts,
      correct: item.correct,
      incorrect: item.incorrect,
      unanswered: item.unanswered,
      difficultyLabel: item.difficultyLabel,
      discrimination: item.discrimination,
      discriminationLabel: item.discriminationLabel,
      avgTimeSeconds: item.medianTimeSeconds,
      topDistractor: item.topDistractor,
      flagged: item.flagged,
    })),
  };
};

/**
 * Pure aggregator: turns already-fetched students + submissions into the full
 * "Institution Assessment Report" payload. Shared by the admin and super-admin
 * report builders so both PDFs contain identical analytics. Does no I/O.
 */
const aggregateInstitutionReport = ({ meta, students = [], submissions = [], incompleteSubmissions = [], departmentNameById = new Map(), questionAnalytics = null }) => {
  const totalStudents = students.length;
  const studentById = new Map(students.map((student) => [String(student.id), student]));
  const fallbackDeptName = meta?.departmentName || "-";

  const studentBest = new Map();
  const subjectStudentBest = new Map();
  const subjectStats = new Map();
  let cheatingCases = 0;

  submissions.forEach((submission) => {
    const sid = submission.user?.id || submission.userId;
    if (!sid) return;
    const studentKey = String(sid);

    const scorePercent = formatScorePercent(submission.score, submission.test?.totalMarks || 0);
    const timeMin = secondsToMinutes(submission.timeSpentSeconds);
    const violationCount = toNumber(submission.violationCount || submission.violations?.length || 0);
    if (violationCount > 0) cheatingCases += 1;

    const deptId = String(submission.user?.departmentId || studentById.get(studentKey)?.departmentId || "");
    const deptName = departmentNameById.get(deptId) || fallbackDeptName;

    const record = {
      studentId: studentKey,
      name: submission.user?.fullName || "Student",
      email: submission.user?.email || "-",
      year: resolveStudentYear(submission.user),
      registerNumber: getStudentNumber(submission.user),
      departmentId: deptId,
      departmentName: deptName,
      scorePercent,
      timeMin,
      violations: violationCount,
      violationsByType: submission.violations || [],
    };

    const current = studentBest.get(studentKey);
    if (!current || scorePercent > current.scorePercent) {
      studentBest.set(studentKey, record);
    }

    const subject = normalizeSubject(submission.test?.subject);
    if (!subjectStudentBest.has(subject)) subjectStudentBest.set(subject, new Map());
    const subjectMap = subjectStudentBest.get(subject);
    const existing = subjectMap.get(studentKey);
    if (!existing || scorePercent > existing) subjectMap.set(studentKey, scorePercent);

    const stat = subjectStats.get(subject) || { scores: [], time: [] };
    stat.scores.push(scorePercent);
    stat.time.push(timeMin);
    subjectStats.set(subject, stat);
  });

  const bestRows = Array.from(studentBest.values());
  const studentsAppeared = bestRows.length;
  const studentsNotAttended = Math.max(totalStudents - studentsAppeared, 0);
  const scores = bestRows.map((row) => row.scorePercent);
  const times = bestRows.map((row) => row.timeMin).filter((value) => value > 0);
  const averageScore = studentsAppeared > 0 ? round1(scores.reduce((sum, value) => sum + value, 0) / studentsAppeared) : 0;
  const highestScore = scores.length ? round1(Math.max(...scores)) : 0;
  const lowestScore = scores.length ? round1(Math.min(...scores)) : 0;
  const averageTimeMin = times.length ? Math.round(times.reduce((sum, value) => sum + value, 0) / times.length) : 0;

  const passedCount = bestRows.filter((row) => row.scorePercent >= PASS_THRESHOLD_PERCENT).length;
  const failedCount = bestRows.filter((row) => row.scorePercent < PASS_THRESHOLD_PERCENT).length;
  const passPercentage = studentsAppeared > 0 ? round1((passedCount / studentsAppeared) * 100) : 0;
  const placementReadyCount = bestRows.filter((row) => row.scorePercent >= PLACEMENT_READY_PERCENT).length;
  const placementReadyPercent = studentsAppeared > 0 ? round1((placementReadyCount / studentsAppeared) * 100) : 0;

  // Incomplete = opened the test but never produced a reportable submission.
  const attemptedIds = new Set(bestRows.map((row) => row.studentId));
  const incompleteStudents = incompleteSubmissions
    .filter((submission) => !attemptedIds.has(String(submission.user?.id || submission.userId)))
    .map((submission) => ({
      name: submission.user?.fullName || "Student",
      registerNumber: getStudentNumber(submission.user),
      department: departmentNameById.get(String(submission.user?.departmentId)) || fallbackDeptName,
      status: describeIncompleteStatus(submission.status),
    }));

  const subjectPerformance = Array.from(subjectStudentBest.entries())
    .map(([subject, scoresMap]) => {
      const values = Array.from(scoresMap.values());
      const stat = subjectStats.get(subject) || { time: [] };
      const avgScore = values.length ? round1(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
      const timeValues = (stat.time || []).filter((value) => value > 0);
      return {
        subject,
        averageScore: avgScore,
        highest: values.length ? round1(Math.max(...values)) : 0,
        lowest: values.length ? round1(Math.min(...values)) : 0,
        avgTimeMin: timeValues.length ? Math.round(timeValues.reduce((sum, value) => sum + value, 0) / timeValues.length) : 0,
      };
    })
    .sort((a, b) => b.averageScore - a.averageScore);

  const weakSubjects = subjectPerformance
    .slice()
    .sort((a, b) => a.averageScore - b.averageScore)
    .map((row) => ({ subject: row.subject, averageScore: row.averageScore, status: getSubjectStatus(row.averageScore) }));
  const strongSubjects = subjectPerformance.slice(0, 5);

  // Per-department comparison (one row for a department-scoped report, many for
  // a college-wide scope).
  const departmentAgg = new Map();
  const ensureDept = (id, name) => {
    const key = String(id || "");
    if (!departmentAgg.has(key)) {
      departmentAgg.set(key, { departmentId: key, departmentName: name || fallbackDeptName, registered: 0, scores: [], times: [], passed: 0, placement: 0 });
    }
    return departmentAgg.get(key);
  };
  students.forEach((student) => {
    const key = String(student.departmentId || "");
    ensureDept(key, departmentNameById.get(key) || fallbackDeptName).registered += 1;
  });
  bestRows.forEach((row) => {
    const bucket = ensureDept(row.departmentId, row.departmentName);
    bucket.scores.push(row.scorePercent);
    if (row.timeMin > 0) bucket.times.push(row.timeMin);
    if (row.scorePercent >= PASS_THRESHOLD_PERCENT) bucket.passed += 1;
    if (row.scorePercent >= PLACEMENT_READY_PERCENT) bucket.placement += 1;
  });
  const departmentPerformance = Array.from(departmentAgg.values())
    .map((bucket) => {
      const attempted = bucket.scores.length;
      const avg = attempted ? round1(bucket.scores.reduce((sum, value) => sum + value, 0) / attempted) : 0;
      return {
        departmentName: bucket.departmentName,
        registered: bucket.registered,
        attempted,
        notAttended: Math.max(bucket.registered - attempted, 0),
        passed: bucket.passed,
        failed: Math.max(attempted - bucket.passed, 0),
        averageScore: avg,
        highest: attempted ? round1(Math.max(...bucket.scores)) : 0,
        participation: bucket.registered ? round1((attempted / bucket.registered) * 100) : 0,
        passRate: attempted ? round1((bucket.passed / attempted) * 100) : 0,
        placementReady: attempted ? round1((bucket.placement / attempted) * 100) : 0,
        avgTimeMin: bucket.times.length ? Math.round(bucket.times.reduce((sum, value) => sum + value, 0) / bucket.times.length) : 0,
      };
    })
    .sort((a, b) => b.averageScore - a.averageScore)
    .map((row, index) => ({ ...row, rank: index + 1 }));

  const rankedStudents = bestRows
    .slice()
    .sort((a, b) => b.scorePercent - a.scorePercent)
    .map((row, index) => ({
      rank: index + 1,
      studentId: row.studentId,
      name: row.name,
      email: row.email,
      year: row.year,
      registerNumber: row.registerNumber,
      department: row.departmentName,
      scorePercent: round1(row.scorePercent),
      accuracy: round1(row.scorePercent),
      timeMin: row.timeMin,
    }));

  const topPerformers = rankedStudents.slice(0, 20);

  // Map each below-par student to their single weakest subject for guidance.
  const subjectScoreByStudent = new Map();
  subjectStudentBest.forEach((scoresMap, subject) => {
    scoresMap.forEach((value, studentKey) => {
      const list = subjectScoreByStudent.get(studentKey) || [];
      list.push({ subject, score: value });
      subjectScoreByStudent.set(studentKey, list);
    });
  });
  const weakestSubjectFor = (studentKey) => {
    const list = subjectScoreByStudent.get(studentKey) || [];
    if (!list.length) return "-";
    return list.slice().sort((a, b) => a.score - b.score)[0].subject;
  };

  const needImprovement = rankedStudents
    .filter((row) => row.scorePercent < PASS_THRESHOLD_PERCENT)
    .map((row) => ({
      name: row.name,
      registerNumber: row.registerNumber,
      department: row.department,
      scorePercent: row.scorePercent,
      weakSubject: weakestSubjectFor(row.studentId),
      avgTimeMin: row.timeMin,
    }));

  const failedStudents = rankedStudents
    .filter((row) => row.scorePercent < PASS_THRESHOLD_PERCENT)
    .map((row) => ({ name: row.name, registerNumber: row.registerNumber, department: row.department, scorePercent: row.scorePercent }));

  // Attended students grouped by department for the complete listing.
  const attendedGroups = new Map();
  rankedStudents.forEach((row) => {
    const list = attendedGroups.get(row.department) || [];
    list.push({ name: row.name, registerNumber: row.registerNumber, scorePercent: row.scorePercent, result: row.scorePercent >= PASS_THRESHOLD_PERCENT ? "PASS" : "FAIL" });
    attendedGroups.set(row.department, list);
  });
  const attendedByDepartment = Array.from(attendedGroups.entries()).map(([department, list]) => ({ department, students: list }));

  const notAttendedStudents = students
    .filter((student) => !attemptedIds.has(String(student.id)))
    .map((student) => ({
      name: student.fullName || "Student",
      registerNumber: getStudentNumber(student),
      department: departmentNameById.get(String(student.departmentId)) || fallbackDeptName,
      year: resolveStudentYear(student),
    }));

  // Malpractice: per-student violation breakdown by type.
  const malpractice = bestRows
    .filter((row) => row.violations > 0)
    .map((row) => {
      const byType = {};
      (row.violationsByType || []).forEach((violation) => {
        const type = String(violation.type || "OTHER");
        byType[type] = (byType[type] || 0) + 1;
      });
      return { name: row.name, department: row.departmentName, total: row.violations, byType };
    })
    .sort((a, b) => b.total - a.total);

  return {
    meta,
    kpis: {
      totalStudents,
      studentsAppeared,
      studentsNotAttended,
      passedCount,
      failedCount,
      incompleteCount: incompleteStudents.length,
      averageScore,
      highestScore,
      lowestScore,
      averageTimeMin,
      passPercentage,
      placementReadyPercent,
      cheatingCases,
    },
    attendance: {
      attempted: studentsAppeared,
      notAttended: studentsNotAttended,
      incomplete: incompleteStudents.length,
    },
    passFail: {
      passPercent: passPercentage,
      failPercent: round1(100 - passPercentage),
      passedCount,
      failedCount,
    },
    subjectPerformance,
    weakSubjects,
    strongSubjects,
    departmentPerformance,
    topPerformers,
    needImprovement,
    notAttendedStudents,
    incompleteStudents,
    failedStudents,
    attendedByDepartment,
    malpractice,
    studentPerformance: rankedStudents,
    questionAnalytics,
    remarks: meta?.remarks || "",
  };
};

// The tests a report was asked to cover: an explicit multi-test selection
// (filters.testIds) and/or the legacy single filters.testId, de-duplicated.
const resolveSelectedTestIds = (filters = {}) =>
  uniqIds([...(Array.isArray(filters.testIds) ? filters.testIds : []), filters.testId]);

/**
 * Multi-test reports: each student's result in each selected test (best attempt
 * per test), plus a per-test summary. The main aggregation keeps one best score
 * per student across all tests, which would hide how a student did in each one.
 */
const buildTestWiseResults = ({ tests = [], students = [], submissions = [], departmentNameById = new Map(), fallbackDeptName = "-" }) => {
  const ordered = [...tests].sort((a, b) => {
    const at = new Date(a.startsAt || a.endsAt || 0).getTime() || 0;
    const bt = new Date(b.startsAt || b.endsAt || 0).getTime() || 0;
    return at - bt || String(a.title || "").localeCompare(String(b.title || ""));
  });
  const codeByTestId = new Map(ordered.map((test, index) => [String(test.id), `T${index + 1}`]));

  // Best attempt per (student, test).
  const best = new Map();
  const studentInfo = new Map(students.map((student) => [String(student.id), student]));
  submissions.forEach((submission) => {
    const sid = String(submission.user?.id || submission.userId || "");
    const tid = String(submission.testId || submission.test?.id || "");
    if (!sid || !codeByTestId.has(tid)) return;
    const scorePercent = formatScorePercent(submission.score, submission.test?.totalMarks || 0);
    const key = `${sid}:${tid}`;
    const current = best.get(key);
    if (!current || scorePercent > current.scorePercent) {
      best.set(key, {
        scorePercent,
        timeMin: secondsToMinutes(submission.timeSpentSeconds),
        violations: toNumber(submission.violationCount || submission.violations?.length || 0),
      });
    }
    if (!studentInfo.has(sid) && submission.user) studentInfo.set(sid, { id: sid, ...submission.user });
  });

  const testSummaries = ordered.map((test) => {
    const tid = String(test.id);
    const registered = students.filter((student) => isStudentAssignedToTest(student, test)).length;
    const scores = [];
    best.forEach((value, key) => {
      if (key.endsWith(`:${tid}`)) scores.push(value.scorePercent);
    });
    const attempted = scores.length;
    return {
      code: codeByTestId.get(tid),
      testId: tid,
      title: test.title || "Untitled test",
      subject: test.subject || "",
      date: test.startsAt || test.endsAt || null,
      registered,
      attempted,
      notAttended: Math.max(registered - attempted, 0),
      averageScore: attempted ? round1(scores.reduce((sum, value) => sum + value, 0) / attempted) : 0,
      passRate: attempted ? round1((scores.filter((value) => value >= PASS_THRESHOLD_PERCENT).length / attempted) * 100) : 0,
    };
  });

  const rows = Array.from(studentInfo.values())
    .map((student) => {
      const sid = String(student.id);
      const cells = ordered.map((test) => {
        const tid = String(test.id);
        const result = best.get(`${sid}:${tid}`);
        if (result) return { code: codeByTestId.get(tid), status: "scored", scorePercent: round1(result.scorePercent), violations: result.violations };
        return { code: codeByTestId.get(tid), status: isStudentAssignedToTest(student, test) ? "absent" : "not_assigned" };
      });
      const scored = cells.filter((cell) => cell.status === "scored");
      if (!scored.length && !cells.some((cell) => cell.status === "absent")) return null;
      return {
        studentId: sid,
        name: student.fullName || "Student",
        registerNumber: getStudentNumber(student),
        department: departmentNameById.get(String(student.departmentId)) || fallbackDeptName,
        cells,
        testsTaken: scored.length,
        averageScore: scored.length ? round1(scored.reduce((sum, cell) => sum + cell.scorePercent, 0) / scored.length) : null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.averageScore ?? -1) - (a.averageScore ?? -1) || a.name.localeCompare(b.name));

  return { tests: testSummaries, students: rows };
};

/**
 * Role-agnostic core that assembles the full "Institution Assessment Report"
 * payload for an already-resolved college / department / batch scope. This is the
 * single source of truth for the comprehensive multi-page report: the College
 * Admin and Super Admin builders both delegate here, so their PDFs are identical
 * for the same scope. Scope resolution (who the requester is, which college /
 * department applies) is the caller's job; this function only fetches data and
 * aggregates it.
 */
const buildInstitutionReportPayload = async ({
  db,
  job,
  collegeId,
  departmentId = null,
  batchId = null,
  collegeName = "-",
  departmentFallbackName = "-",
}) => {
  const filters = job.filters || {};
  const scopedDepartmentId = departmentId ? String(departmentId) : null;
  const scopedBatchId = batchId ? String(batchId) : null;
  const selectedTestIds = resolveSelectedTestIds(filters);
  // One selected test keeps the single-test report exactly as before; several
  // selected tests produce a multi-test report scoped to just those tests.
  const testId = selectedTestIds.length === 1 ? selectedTestIds[0] : null;
  const isMultiTest = selectedTestIds.length > 1;
  const year = filters.year ? Number(filters.year) : null;
  const studentLifecycleWhere = buildStudentLifecycleWhere(filters);

  const batchWhere = { collegeId, ...(scopedDepartmentId ? { departmentId: scopedDepartmentId } : {}) };
  const scopeBatches = await db.batch.findMany({
    where: batchWhere,
    select: { id: true, name: true, academicYear: true, departmentId: true },
  });
  const scopeBatchIds = scopeBatches.map((batch) => String(batch.id));
  const scopedBatch = scopedBatchId ? scopeBatches.find((batch) => String(batch.id) === scopedBatchId) : null;

  if (scopedBatchId && !scopedBatch) {
    throw new Error("Batch not found for this department");
  }

  const departments = await db.department.findMany({
    where: { collegeId, ...(scopedDepartmentId ? { id: scopedDepartmentId } : {}) },
    select: { id: true, name: true },
  });
  const departmentNameById = new Map(departments.map((dept) => [String(dept.id), dept.name]));

  const tests = await buildTestScope({
    db,
    collegeId,
    departmentId: scopedDepartmentId,
    batchIds: scopeBatchIds,
    testId,
    testIds: isMultiTest ? selectedTestIds : [],
  });

  const testIds = tests.map((test) => test.id);
  const selectedTest = testId ? tests.find((test) => String(test.id) === testId) || tests[0] : null;
  const testTitle = testId
    ? selectedTest?.title || "Selected Test"
    : isMultiTest
      ? tests.map((test) => test.title || "Untitled test").join(", ") || "Selected Tests"
      : tests.length > 1
      ? "All Tests"
      : tests[0]?.title || "All Tests";
  const durationMins = selectedTest?.durationMins || (tests.length === 1 ? tests[0]?.durationMins : null) || null;
  const testDate = selectedTest?.startsAt || selectedTest?.endsAt || (tests.length === 1 ? tests[0]?.startsAt : null) || null;

  // Test-type-aware report generation: a single selected test drives the report
  // content. A MODULE_TEST renders per-module student analytics (each module's
  // score + the overall score); every other scope renders the standard report.
  const reportTest = testId ? selectedTest : tests.length === 1 ? tests[0] : null;
  const isModuleTestReport = Boolean(reportTest) && String(reportTest.assessmentFormat || "").toUpperCase() === "MODULE_TEST";

  const studentWhere = {
    collegeId,
    ...(scopedDepartmentId ? { departmentId: scopedDepartmentId } : {}),
    ...studentLifecycleWhere,
    ...(year ? { year } : {}),
    ...(scopedBatchId ? { OR: [{ batchId: scopedBatchId }, { batchIds: { in: [scopedBatchId] } }] } : {}),
  };

  const students = await db.student.findMany({
    where: studentWhere,
    include: {
      batch: { select: { name: true, year: true, academicYear: true } },
    },
  });

  const meta = {
    departmentName: scopedDepartmentId ? departmentNameById.get(scopedDepartmentId) || departmentFallbackName : "All Departments",
    collegeName: collegeName || "-",
    testTitle,
    subject: selectedTest?.subject
      || (tests.length === 1 ? tests[0]?.subject : "")
      || (isMultiTest ? [...new Set(tests.map((test) => test.subject).filter(Boolean))].join(", ") : "")
      || "Placement Assessment",
    semester: resolveSemester(filters),
    academicYear: resolveAcademicYear({ filters, batch: scopedBatch }),
    logoUrl: resolveLogoUrl(filters),
    hasSelectedTest: Boolean(testId) || isMultiTest,
    isMultiTest: isMultiTest || undefined,
    selectedTestCount: isMultiTest ? tests.length : undefined,
    reportScope: buildReportScopeMetadata(filters),
    reportId: buildReportId(job),
    generatedBy: "Analytics Edify LMS",
    durationMins,
    testDate,
    departmentsCount: departments.length,
    remarks: resolveRemarks(filters),
    assessmentFormat: reportTest?.assessmentFormat ? String(reportTest.assessmentFormat).toUpperCase() : undefined,
    isModuleTest: isModuleTestReport || undefined,
  };

  let submissions = [];
  let incompleteSubmissions = [];
  if (testIds.length > 0) {
    const submissionDateFilter = buildSubmissionDateFilter(filters);
    const submissionUserWhere = {
      ...studentLifecycleWhere,
      ...(scopedDepartmentId ? { departmentId: scopedDepartmentId } : {}),
      ...(year ? { year } : {}),
      ...(scopedBatchId ? { OR: [{ batchId: scopedBatchId }, { batchIds: { in: [scopedBatchId] } }] } : {}),
    };

    [submissions, incompleteSubmissions] = await Promise.all([
      db.submission.findMany({
        where: {
          collegeId,
          testId: { in: testIds },
          status: { in: REPORTABLE_SUBMISSION_STATUSES },
          ...(submissionDateFilter ? { submittedAt: submissionDateFilter } : {}),
          ...(Object.keys(submissionUserWhere).length ? { user: submissionUserWhere } : {}),
        },
        include: REPORT_SUBMISSION_INCLUDE,
      }),
      db.submission.findMany({
        where: {
          collegeId,
          testId: { in: testIds },
          status: { in: ["IN_PROGRESS"] },
          ...(Object.keys(submissionUserWhere).length ? { user: submissionUserWhere } : {}),
        },
        include: REPORT_INCOMPLETE_INCLUDE,
      }),
    ]);
  }

  // Per-question item analysis only applies to a single selected test.
  const singleTest = reportTest;
  const questionAnalytics = singleTest ? await buildQuestionAnalytics({ db, test: singleTest, submissions }) : null;

  // A single selected test only "registers" the students actually assigned to it,
  // so a batch-assigned test counts just that batch — not the whole department —
  // as registered / not-attended.
  // Several selected tests register the students assigned to any of them.
  const scopedStudents = singleTest
    ? students.filter((student) => isStudentAssignedToTest(student, singleTest))
    : isMultiTest
      ? students.filter((student) => tests.some((test) => isStudentAssignedToTest(student, test)))
      : students;

  const report = aggregateInstitutionReport({ meta, students: scopedStudents, submissions, incompleteSubmissions, departmentNameById, questionAnalytics });

  if (isMultiTest) {
    report.testWiseResults = buildTestWiseResults({
      tests,
      students: scopedStudents,
      submissions,
      departmentNameById,
      fallbackDeptName: meta.departmentName,
    });
  }

  // Test-type-aware report generation: a MODULE_TEST renders per-module analytics
// (each module score + overall score per student). No-op for OPEN_TEST or
// multi-test scopes, which render the standard report unchanged.
  if (isModuleTestReport) {
    const modulePerformance = aggregateModulePerformance(submissions, { modules: singleTest.modules });
    const submissionById = new Map(submissions.map((submission) => [String(submission.userId), submission]));
    modulePerformance.studentRows = modulePerformance.studentRows.map((row) => {
      const submission = submissionById.get(String(row.userId)) || {};
      const user = submission.user || {};
      return {
        ...row,
        name: user.fullName || user.email || user.enrollNumber || user.studentId || row.userId,
        rollNo: getStudentNumber(user),
        department: departmentNameById.get(String(user.departmentId)) || user.departmentId || "-",
        year: user.year != null ? String(user.year) : "-",
        status: submission.status || undefined,
      };
    });
    report.modulePerformance = modulePerformance;
  }

  return report;
};

const buildDepartmentReportPayload = async ({ db, job }) => {
  const filters = job.filters || {};
  const admin = await db.admin.findUnique({
    where: { id: job.adminId },
    include: {
      department: { select: { id: true, name: true } },
      college: { select: { id: true, name: true } },
    },
  });

  // Prefer an explicit filter department, then the admin's own department.
  // A college-wide admin (no department) falls back to a college-wide scope
  // instead of throwing, so the report renders for every panel.
  const departmentId = filters.departmentId
    ? String(filters.departmentId)
    : admin?.departmentId
      ? String(admin.departmentId)
      : null;

  return buildInstitutionReportPayload({
    db,
    job,
    collegeId: job.collegeId,
    departmentId,
    batchId: filters.batchId ? String(filters.batchId) : null,
    collegeName: admin?.college?.name || "-",
    departmentFallbackName: admin?.department?.name || "-",
  });
};

module.exports = {
  buildDepartmentReportPayload,
  buildInstitutionReportPayload,
  aggregateInstitutionReport,
  buildQuestionAnalytics,
  isStudentAssignedToTest,
  buildReportId,
  buildTestScope,
  buildTestWiseResults,
  resolveSelectedTestIds,
  REPORT_SUBMISSION_INCLUDE,
  REPORT_INCOMPLETE_INCLUDE,
};
