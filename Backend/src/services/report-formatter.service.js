/**
 * Report Formatter Service
 * Converts raw report data into a self-contained, print-ready HTML report.
 *
 * IMPORTANT: every chart here is rendered as inline SVG/CSS on the server. The
 * report must NOT reference any external script, font, stylesheet, or image,
 * because it is rendered to PDF by a headless browser that may run on a
 * network-isolated host. A single unreachable CDN request would otherwise hang
 * the whole render and surface to admins as "error while generating PDF".
 */

const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/\"/g, "&quot;")
  .replace(/'/g, "&#39;");

const formatDateValue = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const clampPercent = (value) => Math.max(0, Math.min(100, Number(value || 0)));
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const round1 = (value) => Math.round(num(value) * 10) / 10;
const formatPercentCompact = (value) => `${round1(clampPercent(value)).toFixed(1)}%`;

const PALETTE = {
  primary: "#2563EB",
  success: "#16A34A",
  danger: "#DC2626",
  amber: "#D97706",
  violet: "#7C3AED",
  cyan: "#0891B2",
  slate: "#64748B",
  track: "#EEF2F7",
};
const SERIES = [PALETTE.primary, PALETTE.success, PALETTE.amber, PALETTE.violet, PALETTE.cyan, PALETTE.danger, "#0EA5E9", "#EA580C"];

// ============ Inline SVG chart primitives ============

const svgDoughnut = (segments = [], { size = 168, thickness = 30, centerTop = "", centerSub = "" } = {}) => {
  const usable = segments.filter((seg) => num(seg.value) > 0);
  const total = usable.reduce((sum, seg) => sum + num(seg.value), 0);
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const arcs = total > 0
    ? usable.map((seg) => {
        const dash = (num(seg.value) / total) * circumference;
        const arc = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="${thickness}" stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})" />`;
        offset += dash;
        return arc;
      }).join("")
    : "";
  return `
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${PALETTE.track}" stroke-width="${thickness}" />
      ${arcs}
      ${centerTop ? `<text x="${cx}" y="${cy - 1}" text-anchor="middle" font-size="21" font-weight="700" fill="#0F172A">${escapeHtml(centerTop)}</text>` : ""}
      ${centerSub ? `<text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="9.5" fill="#64748B">${escapeHtml(centerSub)}</text>` : ""}
    </svg>`;
};

const chartLegend = (segments = []) => `
  <div class="legend">
    ${segments.map((seg) => `
      <div class="legend-item">
        <span class="legend-dot" style="background:${seg.color}"></span>
        <span class="legend-label">${escapeHtml(seg.label)}</span>
        <span class="legend-value">${escapeHtml(String(seg.value))}</span>
      </div>`).join("")}
  </div>`;

// Horizontal labelled bars used for department/subject comparisons.
const svgBarList = (items = [], { max = 100, unit = "%", color = PALETTE.primary } = {}) => {
  if (!items.length) return `<p class="muted">No data available.</p>`;
  const ceiling = Math.max(max, ...items.map((item) => num(item.value))) || 1;
  return `
    <div class="bar-list">
      ${items.map((item, index) => {
        const width = clampPercent((num(item.value) / ceiling) * 100);
        const fill = item.color || (color === "series" ? SERIES[index % SERIES.length] : color);
        return `
          <div class="bar-row">
            <div class="bar-label" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${width}%;background:${fill}"></div></div>
            <div class="bar-value">${escapeHtml(item.display ?? `${round1(item.value)}${unit}`)}</div>
          </div>`;
      }).join("")}
    </div>`;
};

// Vertical column chart (score-band distribution).
const svgColumns = (items = [], { width = 460, height = 170, color = PALETTE.primary } = {}) => {
  if (!items.length) return `<p class="muted">No data available.</p>`;
  const max = Math.max(1, ...items.map((item) => num(item.value)));
  const padBottom = 24;
  const padTop = 14;
  const gap = 14;
  const barW = (width - gap * (items.length + 1)) / items.length;
  const plotH = height - padBottom - padTop;
  const bars = items.map((item, index) => {
    const h = (num(item.value) / max) * plotH;
    const x = gap + index * (barW + gap);
    const y = padTop + (plotH - h);
    const fill = item.color || color;
    return `
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="3" fill="${fill}" />
      <text x="${(x + barW / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="#0F172A">${escapeHtml(String(item.value))}</text>
      <text x="${(x + barW / 2).toFixed(1)}" y="${(height - 8).toFixed(1)}" text-anchor="middle" font-size="9" fill="#64748B">${escapeHtml(item.label)}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img"><line x1="0" y1="${height - padBottom}" x2="${width}" y2="${height - padBottom}" stroke="#E2E8F0" />${bars}</svg>`;
};

// ============ Comprehensive Institution Assessment Report ============

const normalizeAdminReportPayload = (reportData = {}) => {
  if (reportData?.meta) return reportData;
  if (reportData?.rows?.meta) return reportData.rows;
  return reportData || {};
};

const kpiCard = (value, label, tone = "") => `
  <div class="kpi-card ${tone}">
    <div class="kpi-value">${escapeHtml(String(value))}</div>
    <div class="kpi-label">${escapeHtml(label)}</div>
  </div>`;

const sheetFooter = (meta, page, total) => `
  <div class="sheet-footer">
    <span>${escapeHtml(meta.generatedBy || "Analytics Edify LMS")} · Institution Assessment Report</span>
    <span>Generated ${escapeHtml(formatDateValue(meta.testDate || new Date()))}</span>
    <span>Page ${page} of ${total}</span>
    <span>Confidential</span>
  </div>`;

const tableOrEmpty = (rows, columns, emptyMessage) => {
  if (!rows.length) return `<p class="muted">${escapeHtml(emptyMessage)}</p>`;
  return `
    <table class="table">
      <thead><tr>${columns.map((col) => `<th class="${col.align || ""}">${escapeHtml(col.label)}</th>`).join("")}</tr></thead>
      <tbody>
        ${rows.map((row) => `<tr>${columns.map((col) => `<td class="${col.align || ""}">${col.render ? col.render(row) : escapeHtml(row[col.key] ?? "-")}</td>`).join("")}</tr>`).join("")}
      </tbody>
    </table>`;
};

const resultPill = (result) => {
  const pass = String(result).toUpperCase() === "PASS";
  return `<span class="pill ${pass ? "pill-pass" : "pill-fail"}">${escapeHtml(result)}</span>`;
};

// MODULE_TEST: module-wise summary + per-student module breakdown. Rendered as
// an extra sheet only when the report payload carries `modulePerformance`.
const formatSecondsShort = (seconds) => {
  const safe = Math.max(0, Math.floor(num(seconds)));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}m ${String(secs).padStart(2, "0")}s`;
};

const formatStatusLabel = (status) => {
  if (!status) return "-";
  return String(status)
    .split("_")
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : part))
    .join(" ");
};

const moduleAnalyticsSheet = (modulePerformance = {}, meta = {}) => {
  const moduleStats = Array.isArray(modulePerformance.moduleStats) ? modulePerformance.moduleStats : [];
  const studentRows = Array.isArray(modulePerformance.studentRows) ? modulePerformance.studentRows : [];
  const moduleDefs = Array.isArray(modulePerformance.modules) ? modulePerformance.modules : moduleStats;

  const summaryTable = tableOrEmpty(moduleStats, [
    { label: "Module", render: (row) => escapeHtml(`${row.order}. ${row.name}`) },
    { label: "Avg Score", align: "num", render: (row) => `${round1(row.averageScore)} / ${round1(row.averageMaxScore)}` },
    { label: "Avg %", align: "num", render: (row) => `${round1(row.averagePercentage)}%` },
    { label: "Completion", align: "num", render: (row) => `${round1(row.completionRate)}%` },
    { label: "Avg Time", align: "num", render: (row) => formatSecondsShort(row.averageTimeSeconds) },
  ], "No module analytics available.");

  const perStudentColumns = [
    { label: "Student", render: (row) => escapeHtml(row.name || row.studentName || row.userId || "-") },
    { label: "Reg No", render: (row) => escapeHtml(row.rollNo || row.registerNumber || "-") },
    ...moduleDefs.map((mod) => ({
      label: mod.name,
      align: "num",
      render: (row) => {
        const found = (row.modules || []).find((m) => m.key === mod.key) || {};
        const maxScore = round1(found.maxScore);
        const pct = found.maxScore > 0 ? round1(((found.score || 0) / found.maxScore) * 100) : 0;
        return `${round1(found.score)}/${maxScore} (${pct}%)`;
      },
    })),
    { label: "Overall", align: "num", render: (row) => `${round1(row.overallScore)}/${round1(row.overallMaxScore)} (${round1(row.overallPercentage)}%)` },
    { label: "Status", render: (row) => escapeHtml(formatStatusLabel(row.status)) },
    { label: "Time", align: "num", render: (row) => formatSecondsShort(row.totalActualTimeSeconds) },
  ];

  return `
    <section class="sheet">
      <h2 class="section-title">Section Performance (Module Test)</h2>
      ${summaryTable}
      <h2 class="section-title">Student Module Breakdown</h2>
      ${tableOrEmpty(studentRows, perStudentColumns, "No student module data available.")}
      ${sheetFooter(meta, "M", "M")}
    </section>`;
};

const buildInstitutionReportHTML = (reportJob, reportData) => {
  const payload = normalizeAdminReportPayload(reportData);
  const meta = payload.meta || {};
  const kpis = payload.kpis || {};
  const attendance = payload.attendance || {};
  const passFail = payload.passFail || {};

  const studentPerformance = Array.isArray(payload.studentPerformance) && payload.studentPerformance.length
    ? payload.studentPerformance
    : Array.isArray(payload.scoreboard) ? payload.scoreboard : [];

  const topPerformers = (Array.isArray(payload.topPerformers) && payload.topPerformers.length
    ? payload.topPerformers
    : studentPerformance).slice(0, 20);
  const needImprovement = Array.isArray(payload.needImprovement) ? payload.needImprovement : [];
  const notAttendedStudents = Array.isArray(payload.notAttendedStudents) ? payload.notAttendedStudents : [];
  const incompleteStudents = Array.isArray(payload.incompleteStudents) ? payload.incompleteStudents : [];
  const failedStudents = Array.isArray(payload.failedStudents) ? payload.failedStudents : [];
  const attendedByDepartment = Array.isArray(payload.attendedByDepartment) ? payload.attendedByDepartment : [];
  const departmentPerformance = Array.isArray(payload.departmentPerformance) ? payload.departmentPerformance : [];
  const subjectPerformance = Array.isArray(payload.subjectPerformance) ? payload.subjectPerformance : [];
  const weakSubjects = Array.isArray(payload.weakSubjects) ? payload.weakSubjects : [];
  const strongSubjects = Array.isArray(payload.strongSubjects) ? payload.strongSubjects.slice(0, 5) : subjectPerformance.slice(0, 5);
  const malpractice = Array.isArray(payload.malpractice) ? payload.malpractice : [];

  const registered = num(kpis.totalStudents);
  const attempted = num(kpis.studentsAppeared);
  const notAttended = num(kpis.studentsNotAttended != null ? kpis.studentsNotAttended : attendance.notAttended);
  const passed = num(kpis.passedCount != null ? kpis.passedCount : passFail.passedCount);
  const failed = num(kpis.failedCount != null ? kpis.failedCount : passFail.failedCount);
  const incomplete = num(kpis.incompleteCount != null ? kpis.incompleteCount : attendance.incomplete);

  // Score-band distribution derived from the ranked list.
  const bands = [
    { label: "0-20", min: 0, max: 20 },
    { label: "21-40", min: 20, max: 40 },
    { label: "41-60", min: 40, max: 60 },
    { label: "61-80", min: 60, max: 80 },
    { label: "81-100", min: 80, max: 100 },
  ];
  const distribution = bands.map((band, index) => ({
    label: band.label,
    value: studentPerformance.filter((row) => {
      const score = num(row.scorePercent ?? row.score ?? row.avgScore);
      return index === 0 ? score >= band.min && score <= band.max : score > band.min && score <= band.max;
    }).length,
    color: SERIES[index % SERIES.length],
  }));

  const attendanceSegments = [
    { label: "Attempted", value: attempted, color: PALETTE.primary },
    { label: "Not Attended", value: notAttended, color: PALETTE.slate },
    { label: "Incomplete", value: incomplete, color: PALETTE.amber },
  ];
  const passFailSegments = [
    { label: "Pass", value: passed, color: PALETTE.success },
    { label: "Fail", value: failed, color: PALETTE.danger },
  ];

  // Multi-test reports list the selected tests and their date range instead of
  // a single test's name, date and duration.
  const testWise = payload.testWiseResults && Array.isArray(payload.testWiseResults.tests) && payload.testWiseResults.tests.length > 1
    ? payload.testWiseResults
    : null;
  const testDates = testWise ? testWise.tests.map((test) => test.date).filter(Boolean).map((value) => new Date(value)).filter((date) => Number.isFinite(date.getTime())) : [];
  const dateRangeLabel = testDates.length
    ? (() => {
        const first = new Date(Math.min(...testDates));
        const last = new Date(Math.max(...testDates));
        return first.getTime() === last.getTime() ? formatDateValue(first) : `${formatDateValue(first)} – ${formatDateValue(last)}`;
      })()
    : formatDateValue(meta.testDate || reportJob.generatedAt);

  const infoRows = [
    [testWise ? `Tests (${testWise.tests.length})` : "Test Name", meta.testTitle || "-"],
    ["Subject", meta.subject || "-"],
    ["Date", testWise ? dateRangeLabel : formatDateValue(meta.testDate || reportJob.generatedAt)],
    ["Duration", !testWise && meta.durationMins ? `${meta.durationMins} Minutes` : "-"],
    ["Departments", String(meta.departmentsCount ?? departmentPerformance.length ?? "-")],
    ["Generated By", meta.generatedBy || "Analytics Edify LMS"],
    ["Report ID", meta.reportId || "-"],
  ];

  // Question Analytics is only meaningful for a single selected test; when it is
  // present it becomes an extra page and every page after Subject Analytics shifts
  // by one, so the footer numbering stays correct in both cases.
  const questionAnalytics = payload.questionAnalytics && Array.isArray(payload.questionAnalytics.items) && payload.questionAnalytics.items.length
    ? payload.questionAnalytics
    : null;
  const qaOffset = questionAnalytics ? 1 : 0;
  const testWiseOffset = testWise ? 1 : 0;
  const TOTAL_PAGES = 7 + qaOffset + testWiseOffset;

  // ---- Page 1: Executive summary ----
  const page1 = `
    <section class="sheet">
      <header class="brand">
        <div>
          <h1>Institution Assessment Report</h1>
          <p class="brand-sub">${escapeHtml(meta.generatedBy || "Analytics Edify LMS")}${meta.collegeName && meta.collegeName !== "-" ? ` · ${escapeHtml(meta.collegeName)}` : ""}</p>
        </div>
        ${meta.logoUrl ? `<img class="brand-logo" src="${escapeHtml(meta.logoUrl)}" alt="Logo" />` : `<div class="brand-badge">AE</div>`}
      </header>

      <h2 class="section-title">Test Information</h2>
      <table class="info-table">
        <tbody>${infoRows.map(([field, value]) => `<tr><th>${escapeHtml(field)}</th><td>${escapeHtml(value)}</td></tr>`).join("")}</tbody>
      </table>

      <h2 class="section-title">Key Metrics</h2>
      <div class="kpi-grid">
        ${kpiCard(registered, "Registered Students")}
        ${kpiCard(attempted, "Attempted", "tone-primary")}
        ${kpiCard(notAttended, "Not Attended", "tone-slate")}
        ${kpiCard(passed, "Pass", "tone-success")}
        ${kpiCard(failed, "Fail", "tone-danger")}
        ${kpiCard(incomplete, "Incomplete / Skipped", "tone-amber")}
        ${kpiCard(formatPercentCompact(kpis.averageScore), "Average Score")}
        ${kpiCard(`${round1(kpis.highestScore ?? 0)}%`, "Highest Score", "tone-success")}
        ${kpiCard(`${round1(kpis.lowestScore ?? 0)}%`, "Lowest Score", "tone-danger")}
        ${kpiCard(`${num(kpis.averageTimeMin)} min`, "Average Time")}
        ${kpiCard(formatPercentCompact(kpis.placementReadyPercent), "Placement Ready", "tone-primary")}
        ${kpiCard(num(kpis.cheatingCases), "Cheating Cases", num(kpis.cheatingCases) > 0 ? "tone-danger" : "")}
      </div>

      <div class="chart-row">
        <div class="chart-card">
          <h3 class="chart-title">Attendance</h3>
          <div class="chart-body">
            ${svgDoughnut(attendanceSegments, { centerTop: String(registered), centerSub: "registered" })}
            ${chartLegend(attendanceSegments)}
          </div>
        </div>
        <div class="chart-card">
          <h3 class="chart-title">Pass vs Fail</h3>
          <div class="chart-body">
            ${svgDoughnut(passFailSegments, { centerTop: formatPercentCompact(passFail.passPercent), centerSub: "pass rate" })}
            ${chartLegend(passFailSegments)}
          </div>
        </div>
      </div>

      <div class="chart-card">
        <h3 class="chart-title">Department Comparison — Average Score</h3>
        ${svgBarList(departmentPerformance.map((dept) => ({ label: dept.departmentName, value: dept.averageScore })), { color: "series" })}
      </div>

      ${sheetFooter(meta, 1, TOTAL_PAGES)}
    </section>`;

  // ---- Page 2: Department analytics ----
  const deptColumns = [
    { label: "Department", key: "departmentName" },
    { label: "Reg.", align: "num", render: (row) => num(row.registered) },
    { label: "Att.", align: "num", render: (row) => num(row.attempted) },
    { label: "Not Att.", align: "num", render: (row) => num(row.notAttended) },
    { label: "Pass", align: "num", render: (row) => num(row.passed) },
    { label: "Fail", align: "num", render: (row) => num(row.failed) },
    { label: "Avg", align: "num", render: (row) => `${round1(row.averageScore)}%` },
    { label: "High", align: "num", render: (row) => `${round1(row.highest)}%` },
  ];
  const page2 = `
    <section class="sheet">
      <h2 class="section-title">Department Analytics</h2>
      ${tableOrEmpty(departmentPerformance, deptColumns, "No department data available.")}

      <div class="chart-grid-2">
        <div class="chart-card">
          <h3 class="chart-title">Department Performance</h3>
          ${svgBarList(departmentPerformance.map((dept) => ({ label: dept.departmentName, value: dept.averageScore })), { color: "series" })}
        </div>
        <div class="chart-card">
          <h3 class="chart-title">Placement Ready %</h3>
          ${svgBarList(departmentPerformance.map((dept) => ({ label: dept.departmentName, value: dept.placementReady })), { color: PALETTE.violet })}
        </div>
        <div class="chart-card">
          <h3 class="chart-title">Attendance / Participation %</h3>
          ${svgBarList(departmentPerformance.map((dept) => ({ label: dept.departmentName, value: dept.participation })), { color: PALETTE.cyan })}
        </div>
        <div class="chart-card">
          <h3 class="chart-title">Pass Rate %</h3>
          ${svgBarList(departmentPerformance.map((dept) => ({ label: dept.departmentName, value: dept.passRate })), { color: PALETTE.success })}
        </div>
      </div>

      <h3 class="chart-title">Department Ranking</h3>
      ${tableOrEmpty(departmentPerformance, [
        { label: "Rank", align: "num", render: (row) => `#${num(row.rank)}` },
        { label: "Department", key: "departmentName" },
        { label: "Avg Score", align: "num", render: (row) => `${round1(row.averageScore)}%` },
        { label: "Placement Ready", align: "num", render: (row) => `${round1(row.placementReady)}%` },
        { label: "Avg Time", align: "num", render: (row) => `${num(row.avgTimeMin)} min` },
      ], "No ranking data available.")}

      ${sheetFooter(meta, 2, TOTAL_PAGES)}
    </section>`;

  // ---- Page 3: Student analytics ----
  const page3 = `
    <section class="sheet">
      <h2 class="section-title">Student Analytics — Top Performers</h2>
      ${tableOrEmpty(topPerformers, [
        { label: "Rank", align: "num", render: (row) => `#${num(row.rank)}` },
        { label: "Name", render: (row) => escapeHtml(row.name || row.studentName || "-") },
        { label: "Reg No", render: (row) => escapeHtml(row.registerNumber || row.rollNo || row.studentId || "-") },
        { label: "Dept", render: (row) => escapeHtml(row.department || "-") },
        { label: "Score", align: "num", render: (row) => `${round1(row.scorePercent ?? row.score ?? row.avgScore)}%` },
        { label: "Accuracy", align: "num", render: (row) => `${round1(row.accuracy ?? row.scorePercent ?? row.score)}%` },
        { label: "Time", align: "num", render: (row) => `${num(row.timeMin)} min` },
      ], "No students have submitted this test yet.")}

      <h2 class="section-title">Students Needing Improvement (below 40%)</h2>
      ${tableOrEmpty(needImprovement, [
        { label: "Name", render: (row) => escapeHtml(row.name) },
        { label: "Reg No", render: (row) => escapeHtml(row.registerNumber) },
        { label: "Dept", render: (row) => escapeHtml(row.department) },
        { label: "Score", align: "num", render: (row) => `${round1(row.scorePercent)}%` },
        { label: "Weak Topic", render: (row) => escapeHtml(row.weakSubject) },
        { label: "Avg Time", align: "num", render: (row) => `${num(row.avgTimeMin)} min` },
      ], "No students scored below the pass threshold.")}

      <div class="chart-grid-2">
        <div class="chart-card">
          <h3 class="chart-title">Score Distribution</h3>
          ${svgColumns(distribution)}
        </div>
        <div class="chart-card">
          <h3 class="chart-title">Incomplete / Skipped</h3>
          ${tableOrEmpty(incompleteStudents.slice(0, 12), [
            { label: "Name", render: (row) => escapeHtml(row.name) },
            { label: "Reg No", render: (row) => escapeHtml(row.registerNumber) },
            { label: "Status", render: (row) => escapeHtml(row.status) },
          ], "No incomplete attempts.")}
        </div>
      </div>

      ${sheetFooter(meta, 3, TOTAL_PAGES)}
    </section>`;

  // ---- Page 4: Subject analytics ----
  const page4 = `
    <section class="sheet">
      <h2 class="section-title">Subject Analytics</h2>
      ${tableOrEmpty(subjectPerformance, [
        { label: "Subject", key: "subject" },
        { label: "Average", align: "num", render: (row) => `${round1(row.averageScore)}%` },
        { label: "Highest", align: "num", render: (row) => `${round1(row.highest ?? 0)}%` },
        { label: "Lowest", align: "num", render: (row) => `${round1(row.lowest ?? 0)}%` },
        { label: "Avg Time", align: "num", render: (row) => `${num(row.avgTimeMin)} min` },
        { label: "Status", render: (row) => escapeHtml(getSubjectBand(row.averageScore)) },
      ], "No subject data available.")}

      <div class="chart-grid-2">
        <div class="chart-card">
          <h3 class="chart-title">Subject Comparison</h3>
          ${svgBarList(subjectPerformance.map((row) => ({ label: row.subject, value: row.averageScore })), { color: "series" })}
        </div>
        <div class="chart-card">
          <h3 class="chart-title">Average Time per Subject</h3>
          ${svgBarList(subjectPerformance.map((row) => ({ label: row.subject, value: row.avgTimeMin, display: `${num(row.avgTimeMin)} min` })), { max: Math.max(1, ...subjectPerformance.map((row) => num(row.avgTimeMin))), unit: " min", color: PALETTE.cyan })}
        </div>
      </div>

      <div class="chart-grid-2">
        <div class="chart-card">
          <h3 class="chart-title">Strong Topics</h3>
          ${tableOrEmpty(strongSubjects, [
            { label: "Subject", key: "subject" },
            { label: "Average", align: "num", render: (row) => `${round1(row.averageScore)}%` },
          ], "No data.")}
        </div>
        <div class="chart-card">
          <h3 class="chart-title">Weak Topics</h3>
          ${tableOrEmpty(weakSubjects.slice(0, 5), [
            { label: "Subject", key: "subject" },
            { label: "Average", align: "num", render: (row) => `${round1(row.averageScore)}%` },
            { label: "Status", render: (row) => escapeHtml(row.status) },
          ], "No data.")}
        </div>
      </div>

      ${sheetFooter(meta, 4, TOTAL_PAGES)}
    </section>`;

  // ---- Question Analytics (only when a single test is in scope) ----
  const qaPct = (n, d) => (num(d) > 0 ? round1((num(n) / num(d)) * 100) : 0);
  const questionPage = questionAnalytics
    ? (() => {
        const qaItems = questionAnalytics.items;
        const qaSummary = questionAnalytics.summary || {};
        const difficultyBands = [
          { label: "Easy", key: "EASY", color: PALETTE.success },
          { label: "Moderate", key: "MODERATE", color: PALETTE.primary },
          { label: "Hard", key: "HARD", color: PALETTE.amber },
          { label: "Very Hard", key: "VERY_HARD", color: PALETTE.danger },
        ];
        const difficultyDist = difficultyBands.map((band) => ({
          label: band.label,
          value: qaItems.filter((item) => item.difficultyLabel === band.key).length,
          color: band.color,
        }));
        const accuracyCols = qaItems.slice(0, 14).map((item) => ({ label: `Q${num(item.order)}`, value: qaPct(item.correct, item.attempts), color: PALETTE.primary }));
        return `
    <section class="sheet">
      <h2 class="section-title">Question Analytics</h2>
      <div class="kpi-grid">
        ${kpiCard(num(qaSummary.totalQuestions), "Questions")}
        ${kpiCard(`${round1(num(qaSummary.averageDifficulty) * 100)}%`, "Avg Correct", "tone-primary")}
        ${kpiCard(round1(num(qaSummary.averageDiscrimination)), "Avg Discrimination")}
        ${kpiCard(num(qaSummary.flaggedQuestions), "Need Revision", num(qaSummary.flaggedQuestions) > 0 ? "tone-danger" : "")}
      </div>

      <div class="chart-grid-2">
        <div class="chart-card">
          <h3 class="chart-title">Difficulty Distribution</h3>
          ${svgColumns(difficultyDist)}
        </div>
        <div class="chart-card">
          <h3 class="chart-title">Question Accuracy (Correct %)</h3>
          ${svgColumns(accuracyCols)}
        </div>
      </div>

      <h3 class="chart-title">Per-Question Breakdown</h3>
      ${tableOrEmpty(qaItems, [
          { label: "Q", align: "num", render: (row) => `Q${num(row.order)}` },
          { label: "Difficulty", render: (row) => escapeHtml(String(row.difficultyLabel || "-").replace(/_/g, " ")) },
          { label: "Correct %", align: "num", render: (row) => `${qaPct(row.correct, row.attempts)}%` },
          { label: "Wrong %", align: "num", render: (row) => `${qaPct(row.incorrect, row.attempts)}%` },
          { label: "Skipped %", align: "num", render: (row) => `${qaPct(row.unanswered, row.attempts)}%` },
          { label: "Avg Time", align: "num", render: (row) => `${num(row.avgTimeSeconds)}s` },
          { label: "Top Wrong", render: (row) => escapeHtml(row.topDistractor || "-") },
          { label: "Discr.", align: "num", render: (row) => round1(num(row.discrimination)) },
          { label: "Status", render: (row) => (row.flagged ? `<span class="pill pill-fail">Revise</span>` : `<span class="pill pill-pass">OK</span>`) },
        ], "No per-question data for this scope.")}

      ${sheetFooter(meta, 5, TOTAL_PAGES)}
    </section>`;
      })()
    : "";

  // ---- Page 5: Failed students + performance table ----
  const page5 = `
    <section class="sheet">
      <h2 class="section-title">Failed Students</h2>
      ${tableOrEmpty(failedStudents, [
        { label: "Name", render: (row) => escapeHtml(row.name) },
        { label: "Reg No", render: (row) => escapeHtml(row.registerNumber) },
        { label: "Department", render: (row) => escapeHtml(row.department) },
        { label: "Score", align: "num", render: (row) => `${round1(row.scorePercent)}%` },
        { label: "Result", render: () => resultPill("FAIL") },
      ], "No students failed this assessment.")}

      <h2 class="section-title">Complete Performance Sheet</h2>
      ${tableOrEmpty(studentPerformance, [
        { label: "Rank", align: "num", render: (row) => `#${num(row.rank)}` },
        { label: "Name", render: (row) => escapeHtml(row.name || row.studentName || "-") },
        { label: "Reg No", render: (row) => escapeHtml(row.registerNumber || row.rollNo || row.studentId || "-") },
        { label: "Dept", render: (row) => escapeHtml(row.department || "-") },
        { label: "Year", render: (row) => escapeHtml(row.year || "-") },
        { label: "Score", align: "num", render: (row) => `${round1(row.scorePercent ?? row.score ?? row.avgScore)}%` },
        { label: "Result", render: (row) => resultPill(num(row.scorePercent ?? row.score ?? row.avgScore) >= 40 ? "PASS" : "FAIL") },
      ], "No students have submitted this test yet.")}

      ${sheetFooter(meta, 5 + qaOffset, TOTAL_PAGES)}
    </section>`;

  // ---- Page 6: Complete lists + malpractice ----
  const attendedBlocks = attendedByDepartment.length
    ? attendedByDepartment.map((group) => `
        <div class="group-block">
          <h4 class="group-title">${escapeHtml(group.department)}</h4>
          ${tableOrEmpty(group.students, [
            { label: "Name", render: (row) => escapeHtml(row.name) },
            { label: "Reg No", render: (row) => escapeHtml(row.registerNumber) },
            { label: "Score", align: "num", render: (row) => `${round1(row.scorePercent)}%` },
            { label: "Result", render: (row) => resultPill(row.result) },
          ], "No students.")}
        </div>`).join("")
    : `<p class="muted">No attended students in scope.</p>`;

  const page6 = `
    <section class="sheet">
      <h2 class="section-title">Attended Students — Grouped by Department</h2>
      ${attendedBlocks}

      <h2 class="section-title">Not Attended — Grouped by Department</h2>
      ${tableOrEmpty(notAttendedStudents, [
        { label: "Name", render: (row) => escapeHtml(row.name) },
        { label: "Reg No", render: (row) => escapeHtml(row.registerNumber) },
        { label: "Department", render: (row) => escapeHtml(row.department) },
        { label: "Year", render: (row) => escapeHtml(row.year || "-") },
      ], "Every registered student attended.")}

      <h2 class="section-title">Malpractice Cases</h2>
      ${tableOrEmpty(malpractice, [
        { label: "Student", render: (row) => escapeHtml(row.name) },
        { label: "Department", render: (row) => escapeHtml(row.department) },
        { label: "Violations", render: (row) => escapeHtml(Object.entries(row.byType || {}).map(([type, count]) => `${type.replace(/_/g, " ")} ×${count}`).join(", ") || "-") },
        { label: "Total", align: "num", render: (row) => num(row.total) },
      ], "No malpractice cases detected.")}

      ${sheetFooter(meta, 6 + qaOffset, TOTAL_PAGES)}
    </section>`;

  // ---- Page 7: Complete master list, ranked by marks, split by attendance ----
  const page7 = `
    <section class="sheet">
      <h2 class="section-title">Complete Student Test Report — Ranked by Marks</h2>

      <h3 class="chart-title">Attended Students (${studentPerformance.length}) — highest to lowest</h3>
      ${tableOrEmpty(studentPerformance, [
        { label: "Rank", align: "num", render: (row) => `#${num(row.rank)}` },
        { label: "Name", render: (row) => escapeHtml(row.name || row.studentName || "-") },
        { label: "Reg No", render: (row) => escapeHtml(row.registerNumber || row.rollNo || row.studentId || "-") },
        { label: "Department", render: (row) => escapeHtml(row.department || "-") },
        { label: "Year", render: (row) => escapeHtml(row.year || "-") },
        { label: "Marks / Score", align: "num", render: (row) => `${round1(row.scorePercent ?? row.score ?? row.avgScore)}%` },
        { label: "Result", render: (row) => resultPill(num(row.scorePercent ?? row.score ?? row.avgScore) >= 40 ? "PASS" : "FAIL") },
      ], "No students attended this assessment.")}

      <h2 class="section-title">Not Attended Students (${notAttendedStudents.length})</h2>
      ${tableOrEmpty(notAttendedStudents.map((row, index) => ({ ...row, __sno: index + 1 })), [
        { label: "S.No", align: "num", render: (row) => escapeHtml(String(row.__sno)) },
        { label: "Name", render: (row) => escapeHtml(row.name) },
        { label: "Reg No", render: (row) => escapeHtml(row.registerNumber) },
        { label: "Department", render: (row) => escapeHtml(row.department) },
        { label: "Year", render: (row) => escapeHtml(row.year || "-") },
      ], "Every registered student attended.")}

      ${sheetFooter(meta, 7 + qaOffset, TOTAL_PAGES)}
    </section>`;

  // ---- Multi-test only: every student's result in each selected test ----
  const scoreCell = (cell) => {
    if (!cell || cell.status === "not_assigned") return `<span class="muted-cell">—</span>`;
    if (cell.status === "absent") return `<span class="muted-cell">Absent</span>`;
    const value = round1(cell.scorePercent);
    return `<span class="${value >= 40 ? "score-pass" : "score-fail"}">${value}%</span>`;
  };
  const testWisePage = testWise
    ? `
    <section class="sheet">
      <h2 class="section-title">Test-wise Results</h2>
      ${tableOrEmpty(testWise.tests, [
        { label: "Code", render: (row) => `<strong>${escapeHtml(row.code)}</strong>` },
        { label: "Test", render: (row) => escapeHtml(row.title) },
        { label: "Date", render: (row) => escapeHtml(row.date ? formatDateValue(row.date) : "-") },
        { label: "Attempted", align: "num", render: (row) => `${num(row.attempted)} / ${num(row.registered)}` },
        { label: "Avg Score", align: "num", render: (row) => `${round1(row.averageScore)}%` },
        { label: "Pass Rate", align: "num", render: (row) => `${round1(row.passRate)}%` },
      ], "No tests selected.")}

      <h3 class="chart-title">Student results by test (best attempt per test)</h3>
      ${tableOrEmpty(Array.isArray(testWise.students) ? testWise.students : [], [
        { label: "Name", render: (row) => escapeHtml(row.name) },
        { label: "Reg No", render: (row) => escapeHtml(row.registerNumber) },
        { label: "Department", render: (row) => escapeHtml(row.department) },
        ...testWise.tests.map((test) => ({
          label: test.code,
          align: "num",
          render: (row) => scoreCell((row.cells || []).find((cell) => cell.code === test.code)),
        })),
        { label: "Average", align: "num", render: (row) => (row.averageScore == null ? "-" : `${round1(row.averageScore)}%`) },
      ], "No student attempted the selected tests.")}

      ${sheetFooter(meta, TOTAL_PAGES, TOTAL_PAGES)}
    </section>`
    : "";

  // Test-type-aware: a MODULE_TEST report always renders the module sheet; the
  // legacy `modulePerformance` presence keeps older payloads working.
  const modulePerformance = payload.modulePerformance || (reportData && reportData.modulePerformance) || null;
  const isModuleReport = meta.isModuleTest === true || Boolean(modulePerformance);
  const modulePage = isModuleReport && Array.isArray(modulePerformance?.moduleStats) && modulePerformance.moduleStats.length
    ? moduleAnalyticsSheet(modulePerformance, meta)
    : "";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Institution Assessment Report</title>${reportStyles()}</head><body>${page1}${modulePage}${page2}${page3}${page4}${questionPage}${page5}${page6}${page7}${testWisePage}</body></html>`;
};

const getSubjectBand = (avg) => {
  const value = num(avg);
  if (value < 50) return "Needs Attention";
  if (value < 70) return "Moderate";
  return "Good";
};

const reportStyles = () => `
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; color: #0F172A; background: #fff; font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif; font-size: 12px; }
    .sheet { position: relative; padding: 22px 26px 46px; min-height: 100vh; page-break-after: always; }
    .sheet:last-child { page-break-after: auto; }
    .brand { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid ${PALETTE.primary}; padding-bottom: 14px; margin-bottom: 18px; }
    .brand h1 { margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.02em; }
    .brand-sub { margin: 4px 0 0; color: ${PALETTE.slate}; font-size: 12px; font-weight: 600; }
    .brand-logo { max-height: 52px; max-width: 130px; object-fit: contain; }
    .brand-badge { width: 52px; height: 52px; border-radius: 14px; background: ${PALETTE.primary}; color: #fff; font-weight: 800; font-size: 20px; display: flex; align-items: center; justify-content: center; }
    .section-title { font-size: 15px; font-weight: 700; margin: 20px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #E2E8F0; }
    .info-table { width: 100%; border-collapse: collapse; }
    .info-table th, .info-table td { text-align: left; padding: 7px 10px; border: 1px solid #E2E8F0; font-size: 12px; }
    .info-table th { width: 32%; background: #F8FAFC; color: ${PALETTE.slate}; font-weight: 600; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
    .kpi-card { border: 1px solid #E2E8F0; border-radius: 12px; padding: 12px 14px; background: #fff; border-left: 3px solid ${PALETTE.primary}; }
    .kpi-card.tone-primary { border-left-color: ${PALETTE.primary}; }
    .kpi-card.tone-success { border-left-color: ${PALETTE.success}; }
    .kpi-card.tone-danger { border-left-color: ${PALETTE.danger}; }
    .kpi-card.tone-amber { border-left-color: ${PALETTE.amber}; }
    .kpi-card.tone-slate { border-left-color: ${PALETTE.slate}; }
    .kpi-value { font-size: 22px; font-weight: 800; line-height: 1.1; }
    .kpi-label { margin-top: 4px; font-size: 10px; color: ${PALETTE.slate}; text-transform: uppercase; letter-spacing: 0.03em; font-weight: 600; }
    .chart-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 16px; }
    .chart-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 12px; }
    .chart-card { border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px; margin-top: 12px; break-inside: avoid; }
    .chart-title { font-size: 12px; font-weight: 700; margin: 0 0 10px; }
    .chart-body { display: flex; align-items: center; gap: 16px; }
    .legend { display: flex; flex-direction: column; gap: 6px; flex: 1; }
    .legend-item { display: flex; align-items: center; gap: 8px; font-size: 11px; }
    .legend-dot { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
    .legend-label { flex: 1; color: #334155; }
    .legend-value { font-weight: 700; }
    .bar-list { display: flex; flex-direction: column; gap: 8px; }
    .bar-row { display: grid; grid-template-columns: 120px 1fr 54px; gap: 10px; align-items: center; }
    .bar-label { font-size: 11px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bar-track { height: 10px; background: ${PALETTE.track}; border-radius: 999px; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 999px; }
    .bar-value { text-align: right; font-size: 11px; font-weight: 700; }
    .table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 4px; }
    .table th, .table td { padding: 6px 8px; border-bottom: 1px solid #E2E8F0; text-align: left; }
    .table th { color: ${PALETTE.slate}; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; font-size: 9.5px; background: #F8FAFC; }
    .table td.num, .table th.num { text-align: right; font-variant-numeric: tabular-nums; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    .pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; }
    .pill-pass { background: rgba(22,163,74,0.12); color: ${PALETTE.success}; }
    .score-pass { color: ${PALETTE.success}; font-weight: 600; }
    .score-fail { color: ${PALETTE.danger}; font-weight: 600; }
    .muted-cell { color: #94A3B8; }
    .pill-fail { background: rgba(220,38,38,0.12); color: ${PALETTE.danger}; }
    .group-block { margin-top: 10px; break-inside: avoid; }
    .group-title { font-size: 12px; font-weight: 700; margin: 8px 0 4px; color: ${PALETTE.primary}; }
    .muted { color: ${PALETTE.slate}; font-size: 12px; padding: 8px 0; }
    .sheet-footer { position: absolute; left: 26px; right: 26px; bottom: 16px; display: flex; justify-content: space-between; gap: 8px; font-size: 9px; color: #94A3B8; border-top: 1px solid #E2E8F0; padding-top: 6px; }
    @media print { .sheet { min-height: auto; } }
  </style>`;

// ============ Report type dispatch ============

const generateAdminReportHTML = (reportJob, reportData) => {
  const { type, generatedAt, expiresAt } = reportJob;
  const rows = reportData?.rows || [];

  // Admin report jobs build the full Institution payload (meta/kpis/…) for EVERY
  // report type — admin-report-queue.service always calls buildDepartmentReportPayload.
  // So whenever we receive that meta-shaped payload, render the comprehensive
  // multi-page report regardless of the job's `type`. Previously TEST_WISE /
  // STUDENT_WISE / BATCH_WISE fell through to row-based formatters and, finding no
  // `.rows`, produced a single empty page.
  if (reportData?.meta || reportData?.rows?.meta) {
    return buildInstitutionReportHTML(reportJob, reportData);
  }

  if (type === "STUDENT_WISE") return formatStudentWiseReport(rows, generatedAt, expiresAt);
  if (type === "TEST_WISE") return formatTestWiseReport(rows, generatedAt, expiresAt);
  if (type === "DEPARTMENT_WISE") return buildInstitutionReportHTML(reportJob, reportData);
  if (type === "BATCH_WISE") return formatBatchWiseReport(rows, generatedAt, expiresAt);
  if (type === "COMPREHENSIVE") return formatComprehensiveReport(reportData, generatedAt, expiresAt);

  return generateBasicHTML("Unknown Report Type", "No formatting available for this report type.");
};

const generateSuperAdminReportHTML = (reportJob, reportData) => {
  const { type, generatedAt, expiresAt } = reportJob;
  const rows = reportData?.rows || [];

  // A meta-shaped payload (produced whenever a specific test is selected) renders
  // the full Institution report regardless of the job's report type.
  if (reportData?.meta || reportData?.rows?.meta) {
    return buildInstitutionReportHTML({ ...reportJob, role: "SUPER_ADMIN" }, reportData);
  }

  if (type === "STUDENT_WISE") return formatStudentWiseReport(rows, generatedAt, expiresAt, true);
  if (type === "TEST_WISE") return formatTestWiseReport(rows, generatedAt, expiresAt, true);
  if (type === "DEPARTMENT_WISE") {
    if (reportData?.meta) return buildInstitutionReportHTML({ ...reportJob, role: "SUPER_ADMIN" }, reportData);
    return formatDepartmentWiseReport(rows, generatedAt, expiresAt, true);
  }
  if (type === "BATCH_WISE") return formatBatchWiseReport(rows, generatedAt, expiresAt, true);
  // College-scoped super jobs always carry the meta payload (handled above); this
  // covers a non-meta payload the same way generateAdminReportHTML does.
  if (type === "COMPREHENSIVE") return formatComprehensiveReport(reportData, generatedAt, expiresAt);

  return generateBasicHTML("Unknown Report Type", "No formatting available for this report type.");
};

// ============ Simple list report formatters (self-contained) ============

const formatStudentWiseReport = (rows = [], generatedAt, expiresAt, isGlobal = false) => {
  const safeRows = [...rows]
    .map((row) => ({
      ...row,
      testName: row.testName || "-",
      date: row.date || row.submittedAt || null,
      scorePercent: num(row.scorePercent ?? row.accuracy ?? row.score),
      timeTaken: num(row.timeTaken),
      violationsCount: num(row.violationsCount || row.violationCount),
      status: row.status || "-",
    }))
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  const totalStudents = safeRows.length;
  const avgScore = totalStudents > 0 ? (safeRows.reduce((sum, r) => sum + r.scorePercent, 0) / totalStudents).toFixed(2) : 0;
  const studentMap = new Map();
  safeRows.forEach((row) => {
    if (!studentMap.has(row.studentId)) studentMap.set(row.studentId, { studentName: row.studentName, scores: [] });
    studentMap.get(row.studentId).scores.push(row.scorePercent);
  });
  const topPerformers = Array.from(studentMap.values())
    .map((s) => ({ name: s.studentName, avgScore: (s.scores.reduce((a, b) => a + b, 0) / s.scores.length), submissions: s.scores.length }))
    .sort((a, b) => b.avgScore - a.avgScore)
    .slice(0, 10);
  const distribution = [
    { label: "0-20", value: safeRows.filter((r) => r.scorePercent <= 20).length, color: SERIES[0] },
    { label: "21-40", value: safeRows.filter((r) => r.scorePercent > 20 && r.scorePercent <= 40).length, color: SERIES[1] },
    { label: "41-60", value: safeRows.filter((r) => r.scorePercent > 40 && r.scorePercent <= 60).length, color: SERIES[2] },
    { label: "61-80", value: safeRows.filter((r) => r.scorePercent > 60 && r.scorePercent <= 80).length, color: SERIES[3] },
    { label: "81-100", value: safeRows.filter((r) => r.scorePercent > 80).length, color: SERIES[4] },
  ];

  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Student-Wise Report</title>${reportStyles()}</head><body>
    <section class="sheet">
      ${basicHeader("Student-Wise Report" + (isGlobal ? " (Platform)" : ""), generatedAt, expiresAt)}
      <div class="kpi-grid">
        ${kpiCard(totalStudents, "Total Submissions")}
        ${kpiCard(`${avgScore}%`, "Average Score", "tone-primary")}
        ${kpiCard(safeRows.reduce((sum, row) => sum + row.violationsCount, 0), "Total Violations", "tone-danger")}
        ${kpiCard(studentMap.size, "Unique Students")}
      </div>
      <div class="chart-card"><h3 class="chart-title">Score Distribution</h3>${svgColumns(distribution)}</div>
      <h2 class="section-title">Top Performing Students</h2>
      ${tableOrEmpty(topPerformers.map((p, i) => ({ ...p, rank: i + 1 })), [
        { label: "Rank", align: "num", render: (row) => row.rank },
        { label: "Student", render: (row) => escapeHtml(row.name) },
        { label: "Avg Score", align: "num", render: (row) => `${row.avgScore.toFixed(2)}%` },
        { label: "Submissions", align: "num", render: (row) => row.submissions },
      ], "No submissions found.")}
      <h2 class="section-title">Test Timeline (${safeRows.length} records)</h2>
      ${tableOrEmpty(safeRows.slice(0, 100), [
        { label: "Date", render: (row) => formatDate(row.date) },
        { label: "Test", render: (row) => escapeHtml(row.testName) },
        { label: "Score", align: "num", render: (row) => `${row.scorePercent.toFixed(2)}%` },
        { label: "Result", render: (row) => resultPill(row.scorePercent >= 40 ? "PASS" : "FAIL") },
        { label: "Time", align: "num", render: (row) => `${Math.round(row.timeTaken / 60)} min` },
        { label: "Violations", align: "num", render: (row) => row.violationsCount },
        { label: "Status", render: (row) => escapeHtml(row.status) },
      ], "No records.")}
      ${safeRows.length > 100 ? `<p class="muted">Showing first 100 of ${safeRows.length} records.</p>` : ""}
    </section></body></html>`;
};

const formatTestWiseReport = (rows = [], generatedAt, expiresAt, isGlobal = false) => {
  const totalTests = rows.length;
  const totalParticipants = rows.reduce((sum, r) => sum + num(r.participants), 0);
  const avgScore = totalTests > 0 ? (rows.reduce((sum, r) => sum + num(r.avgScore), 0) / totalTests).toFixed(2) : 0;
  const topTests = [...rows].sort((a, b) => num(b.avgScore) - num(a.avgScore)).slice(0, 12);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Test-Wise Report</title>${reportStyles()}</head><body>
    <section class="sheet">
      ${basicHeader("Test-Wise Report" + (isGlobal ? " (Platform)" : ""), generatedAt, expiresAt)}
      <div class="kpi-grid">
        ${kpiCard(totalTests, "Total Tests")}
        ${kpiCard(totalParticipants, "Total Participants", "tone-primary")}
        ${kpiCard(`${avgScore}%`, "Average Score", "tone-success")}
        ${kpiCard(rows.filter((r) => r.anomalies && Object.keys(r.anomalies).length > 0).length, "Tests with Anomalies", "tone-danger")}
      </div>
      <div class="chart-card"><h3 class="chart-title">Top Tests — Average Score</h3>
        ${svgBarList(topTests.map((t) => ({ label: t.testName || "-", value: num(t.avgScore) })), { color: "series" })}
      </div>
      <h2 class="section-title">All Tests (${rows.length})</h2>
      ${tableOrEmpty(rows.slice(0, 120), [
        { label: "Test", render: (row) => escapeHtml(row.testName || "-") },
        { label: "Subject", render: (row) => escapeHtml(row.subject || "-") },
        { label: "Participants", align: "num", render: (row) => num(row.participants) },
        { label: "Avg Score", align: "num", render: (row) => `${num(row.avgScore)}%` },
      ], "No tests found.")}
    </section></body></html>`;
};

const formatDepartmentWiseReport = (rows = [], generatedAt, expiresAt, isGlobal = false) => {
  const totalDepts = rows.length;
  const totalStudents = rows.reduce((sum, r) => sum + num(r.students), 0);
  const avgScore = totalDepts > 0 ? (rows.reduce((sum, r) => sum + num(r.avgScore), 0) / totalDepts).toFixed(2) : 0;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Department-Wise Report</title>${reportStyles()}</head><body>
    <section class="sheet">
      ${basicHeader("Department-Wise Report" + (isGlobal ? " (Platform)" : ""), generatedAt, expiresAt)}
      <div class="kpi-grid">
        ${kpiCard(totalDepts, "Total Departments")}
        ${kpiCard(totalStudents, "Total Students", "tone-primary")}
        ${kpiCard(`${avgScore}%`, "Average Score", "tone-success")}
        ${kpiCard(totalDepts ? (totalStudents / totalDepts).toFixed(1) : 0, "Students / Dept")}
      </div>
      <div class="chart-card"><h3 class="chart-title">Department Performance</h3>
        ${svgBarList(rows.map((d) => ({ label: d.departmentName || "-", value: num(d.avgScore) })), { color: "series" })}
      </div>
      <h2 class="section-title">All Departments (${rows.length})</h2>
      ${tableOrEmpty(rows.slice(0, 120), [
        { label: "Department", render: (row) => escapeHtml(row.departmentName || "-") },
        { label: "Students", align: "num", render: (row) => num(row.students) },
        { label: "Avg Score", align: "num", render: (row) => `${num(row.avgScore)}%` },
      ], "No departments found.")}
    </section></body></html>`;
};

const formatBatchWiseReport = (rows = [], generatedAt, expiresAt, isGlobal = false) => {
  const totalBatches = rows.length;
  const totalStudents = rows.reduce((sum, r) => sum + num(r.students), 0);
  const avgScore = totalBatches > 0 ? (rows.reduce((sum, r) => sum + num(r.avgScore), 0) / totalBatches).toFixed(2) : 0;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Batch-Wise Report</title>${reportStyles()}</head><body>
    <section class="sheet">
      ${basicHeader("Batch-Wise Report" + (isGlobal ? " (Platform)" : ""), generatedAt, expiresAt)}
      <div class="kpi-grid">
        ${kpiCard(totalBatches, "Total Batches")}
        ${kpiCard(totalStudents, "Total Students", "tone-primary")}
        ${kpiCard(`${avgScore}%`, "Average Score", "tone-success")}
        ${kpiCard(totalBatches ? (totalStudents / totalBatches).toFixed(1) : 0, "Students / Batch")}
      </div>
      <h2 class="section-title">All Batches (${rows.length})</h2>
      ${tableOrEmpty(rows.slice(0, 120), [
        { label: "Batch", render: (row) => escapeHtml(row.batchName || "-") },
        { label: "Department", render: (row) => escapeHtml(row.departmentName || "-") },
        { label: "Students", align: "num", render: (row) => num(row.students) },
        { label: "Avg Score", align: "num", render: (row) => `${num(row.avgScore)}%` },
      ], "No batches found.")}
    </section></body></html>`;
};

const formatComprehensiveReport = (data = {}, generatedAt, expiresAt) => {
  const summary = data.summary || {};
  const tests = data.tests || [];
  const recentSubmissions = data.recentSubmissions || [];

  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Comprehensive Report</title>${reportStyles()}</head><body>
    <section class="sheet">
      ${basicHeader("Comprehensive Report", generatedAt, expiresAt)}
      <div class="kpi-grid">
        ${kpiCard(num(summary.tests), "Total Tests")}
        ${kpiCard(num(summary.departments), "Departments", "tone-primary")}
        ${kpiCard(num(summary.batches), "Batches")}
        ${kpiCard(num(summary.submissions), "Total Submissions", "tone-success")}
      </div>
      <h2 class="section-title">Top Tests</h2>
      ${tableOrEmpty(tests.slice(0, 12), [
        { label: "Test", render: (row) => escapeHtml(row.testName || "-") },
        { label: "Participants", align: "num", render: (row) => num(row.participants) },
        { label: "Avg Score", align: "num", render: (row) => `${num(row.avgScore)}%` },
      ], "No tests found.")}
      <h2 class="section-title">Recent Submissions</h2>
      ${tableOrEmpty(recentSubmissions.slice(0, 20), [
        { label: "Student", render: (row) => escapeHtml(row.studentName || "-") },
        { label: "Test", render: (row) => escapeHtml(row.testName || "-") },
        { label: "Score", align: "num", render: (row) => num(row.score) },
        { label: "Submitted", render: (row) => formatDate(row.submittedAt) },
      ], "No submissions found.")}
    </section></body></html>`;
};

// ============ Helpers ============

const formatDate = (value) => {
  const date = new Date(value || 0);
  return Number.isFinite(date.getTime()) && value ? date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "-";
};

const basicHeader = (title, generatedAt, expiresAt) => `
  <header class="brand">
    <div>
      <h1>${escapeHtml(title)}</h1>
      <p class="brand-sub">Analytics Edify LMS · Generated ${escapeHtml(formatDate(generatedAt))}${expiresAt ? ` · Valid until ${escapeHtml(formatDate(expiresAt))}` : ""}</p>
    </div>
    <div class="brand-badge">AE</div>
  </header>`;

const generateBasicHTML = (title, message) => `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title>${reportStyles()}</head><body>
  <section class="sheet">${basicHeader(title, new Date(), null)}<p class="muted">${escapeHtml(message)}</p></section>
</body></html>`;

module.exports = {
  generateAdminReportHTML,
  generateSuperAdminReportHTML,
};
