const models = require("../../models");
const { createAuditLog } = require("../../services/audit.service");
const { collectSubmissions } = require("../../services/submission-batch.service");
const { emitToRole } = require("../../realtime/socket");

jest.mock("../../models", () => ({
  init: jest.fn(),
}));

jest.mock("../../services/report-pdf.service", () => ({
  renderHtmlToPdfBuffer: jest.fn(),
}));

jest.mock("../../services/super-admin-report-queue.service", () => ({
  enqueueSuperReportJob: jest.fn(),
}));

jest.mock("../../services/audit.service", () => ({
  createAuditLog: jest.fn(async () => ({})),
}));

jest.mock("../../realtime/socket", () => ({
  emitToRole: jest.fn(),
}));

jest.mock("../../services/submission-batch.service", () => ({
  collectSubmissions: jest.fn(async () => ({ rows: [], truncated: false })),
}));

// Raw-driver lookups need a live mongoose connection; unit tests stub them.
jest.mock("../../services/report-lookup.service", () => ({
  attachStudentGroups: jest.fn(async (_db, students) => students),
  countViolationsBySubmission: jest.fn(async () => new Map()),
  loadNamesById: jest.fn(async () => new Map()),
  sumQuestionMarksByTest: jest.fn(async () => new Map()),
  uniqueIds: (values) => [...new Set((values || []).filter(Boolean).map(String))],
}));

const { reviewReportAnomalySchema } = require("../../schemas/Admin/admin-core.schema");
const { createSuperReportSchema, reviewSuperAnomalySchema } = require("../../schemas/SuperAdmin/super-admin-core.schema");
const { generateSuperAdminReportHTML } = require("../../services/report-formatter.service");
const {
  generateSuperReport,
  getEscalatedAnomalies,
  getSuperReportJobStatus,
  reviewSuperAnomaly,
} = require("../../controllers/SuperAdmin/reports.controller");
const { exportSuperReportCsv } = require("../../controllers/SuperAdmin/advanced-reports.controller");
const { resolveAdminPermissions } = require("../../constants/admin-access-profiles");

const COLLEGE_ID = "64b000000000000000000001";
const TEST_ID = "64b000000000000000000002";

// Resolves with the first response the handler produces (json or send), and
// rejects with any error the handler forwards to next().
const invoke = (handler, req) =>
  new Promise((resolve, reject) => {
    const headers = {};
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      setHeader(name, value) {
        headers[name.toLowerCase()] = value;
      },
      json(payload) {
        resolve({ statusCode: this.statusCode, payload, headers });
        return this;
      },
      send(body) {
        resolve({ statusCode: this.statusCode, body, headers });
        return this;
      },
    };
    handler(req, res, (error) => {
      if (error) reject(error);
    });
  });

const parseBody = (schema, body) => schema.parse({ body, params: {}, query: {} });

describe("super admin report parity — schemas", () => {
  it("accepts COMPREHENSIVE reports with a date range, remarks, and scope ids", () => {
    const parsed = parseBody(createSuperReportSchema, {
      type: "COMPREHENSIVE",
      filters: {
        collegeId: COLLEGE_ID,
        batchId: "batch-1",
        dateFrom: "2026-01-01T00:00:00.000Z",
        dateTo: "2026-01-31T23:59:59.000Z",
        remarks: "Term 1 review",
      },
    });

    expect(parsed.body.type).toBe("COMPREHENSIVE");
    expect(parsed.body.filters).toMatchObject({ collegeId: COLLEGE_ID, batchId: "batch-1", remarks: "Term 1 review" });
  });

  it("rejects an inverted date range", () => {
    expect(() =>
      parseBody(createSuperReportSchema, {
        type: "BATCH_WISE",
        filters: { dateFrom: "2026-02-01T00:00:00.000Z", dateTo: "2026-01-01T00:00:00.000Z" },
      })
    ).toThrow();
  });

  it("accepts proctoring violation types in the admin anomaly review (regression)", () => {
    // Report payloads expose each violation as { anomalyId: violation.id,
    // anomalyType: violation.type }; the schema used to reject these.
    const parsed = parseBody(reviewReportAnomalySchema, {
      testId: TEST_ID,
      anomalyId: "violation-1",
      anomalyType: "TAB_SWITCH",
      action: "ESCALATE",
      reason: "Repeated tab switching",
    });
    expect(parsed.body.anomalyType).toBe("TAB_SWITCH");
  });

  it("lets a super admin confirm or dismiss, but not escalate", () => {
    const body = { testId: TEST_ID, anomalyId: "violation-1", anomalyType: "COPY_PASTE", reason: "Reviewed footage" };
    expect(parseBody(reviewSuperAnomalySchema, { ...body, action: "CONFIRM" }).body.action).toBe("CONFIRM");
    expect(parseBody(reviewSuperAnomalySchema, { ...body, action: "DISMISS" }).body.action).toBe("DISMISS");
    expect(() => parseBody(reviewSuperAnomalySchema, { ...body, action: "ESCALATE" })).toThrow();
  });
});

describe("super admin report parity — formatter", () => {
  it("renders COMPREHENSIVE instead of the unknown-type fallback", () => {
    const html = generateSuperAdminReportHTML({ type: "COMPREHENSIVE", generatedAt: new Date().toISOString() }, {});
    expect(html).not.toContain("Unknown Report Type");
  });
});

describe("super admin report parity — controllers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("reports job status in the same shape as the admin endpoint", async () => {
    const db = {
      superReportJob: {
        findUnique: jest.fn(async () => ({
          id: "job-1",
          status: "PROCESSING",
          resultUrl: null,
          filters: { collegeId: COLLEGE_ID },
        })),
      },
    };
    models.init.mockResolvedValue({ dbClient: db });

    const response = await invoke(getSuperReportJobStatus, { params: { reportJobId: "job-1" } });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toMatchObject({ jobId: "job-1", status: "processing", progress: 60, download_url: null });
  });

  it("returns 404 for an unknown job", async () => {
    models.init.mockResolvedValue({ dbClient: { superReportJob: { findUnique: jest.fn(async () => null) } } });
    const response = await invoke(getSuperReportJobStatus, { params: { reportJobId: "missing" } });
    expect(response.statusCode).toBe(404);
  });

  it("records a super admin anomaly decision and audits it", async () => {
    const update = jest.fn(async () => ({}));
    const db = {
      test: {
        findUnique: jest.fn(async () => ({
          id: TEST_ID,
          collegeId: COLLEGE_ID,
          anomalyReviews: [{ anomalyId: "violation-1", action: "ESCALATE", reviewedByAdminId: "admin-1" }],
        })),
        update,
      },
    };
    models.init.mockResolvedValue({ dbClient: db });

    const response = await invoke(reviewSuperAnomaly, {
      body: { testId: TEST_ID, anomalyId: "violation-1", anomalyType: "TAB_SWITCH", action: "CONFIRM", reason: "Confirmed after review" },
      superAdmin: { id: "super-1" },
    });

    expect(response.statusCode).toBe(200);
    const savedReviews = update.mock.calls[0][0].data.anomalyReviews;
    expect(savedReviews).toHaveLength(1);
    expect(savedReviews[0]).toMatchObject({ anomalyId: "violation-1", action: "CONFIRM", reviewedBySuperAdminId: "super-1" });
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "SUPER_REPORT_ANOMALY_CONFIRMED", superAdminId: "super-1", collegeId: COLLEGE_ID })
    );
    expect(emitToRole).toHaveBeenCalledWith(
      "SUPER_ADMIN",
      "report:anomaly_resolved",
      expect.objectContaining({ testId: TEST_ID, anomalyId: "violation-1", action: "CONFIRM" })
    );
  });

  it("rejects a batch that does not belong to the selected college", async () => {
    const db = {
      college: { findUnique: jest.fn(async () => ({ id: COLLEGE_ID, isActive: true })) },
      batch: { findFirst: jest.fn(async () => null) },
      superReportJob: { create: jest.fn() },
    };
    models.init.mockResolvedValue({ dbClient: db });

    await expect(
      invoke(generateSuperReport, {
        body: { type: "BATCH_WISE", filters: { collegeId: COLLEGE_ID, batchId: "foreign-batch" } },
        superAdmin: { id: "super-1" },
      })
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(db.superReportJob.create).not.toHaveBeenCalled();
  });

  it("exports the tests dataset as CSV scoped to the selected college", async () => {
    const db = {
      college: { findUnique: jest.fn(async () => ({ id: COLLEGE_ID, isActive: true })) },
      batch: { findMany: jest.fn(async () => []) },
      test: {
        findMany: jest.fn(async () => [
          { id: TEST_ID, title: "Aptitude 1", status: "PUBLISHED", totalMarks: 10, department: { name: "CSE" }, batch: { name: "A" }, questions: [] },
        ]),
      },
      student: {
        findMany: jest.fn(async () => [{ id: "s1" }, { id: "s2" }]),
        count: jest.fn(async () => 2),
      },
    };
    models.init.mockResolvedValue({ dbClient: db });
    collectSubmissions.mockResolvedValue({
      rows: [{ testId: TEST_ID, userId: "s1", score: 8, accuracy: 80, _count: { violations: 1 } }],
      truncated: false,
    });

    const response = await invoke(exportSuperReportCsv, { query: { collegeId: COLLEGE_ID, dataset: "tests" } });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.body).toContain("Aptitude 1");
    expect(db.test.findMany.mock.calls[0][0].where).toBeDefined();
  });

  it("rejects an unsupported export dataset", async () => {
    models.init.mockResolvedValue({ dbClient: { college: { findUnique: jest.fn(async () => ({ id: COLLEGE_ID, isActive: true })) } } });
    await expect(invoke(exportSuperReportCsv, { query: { collegeId: COLLEGE_ID, dataset: "bogus" } })).rejects.toMatchObject({ statusCode: 422 });
  });

  it("requires a college for exports", async () => {
    models.init.mockResolvedValue({ dbClient: { college: { findUnique: jest.fn() } } });
    await expect(invoke(exportSuperReportCsv, { query: { dataset: "tests" } })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("report permissions per role", () => {
  it("always grants college admins view and export on reports", () => {
    const permissions = resolveAdminPermissions({ role: "COLLEGE_ADMIN", permissions: ["view_tests"], accessProfile: "VIEW_ONLY" });
    expect(permissions).toEqual(expect.arrayContaining(["view_reports", "export_reports"]));
  });

  it("gives view-only admins report viewing but not exporting", () => {
    const permissions = resolveAdminPermissions({ role: "ADMIN", accessProfile: "VIEW_ONLY" });
    expect(permissions).toContain("view_reports");
    expect(permissions).not.toContain("export_reports");
  });

  it("gives editor admins both report permissions", () => {
    const permissions = resolveAdminPermissions({ role: "ADMIN", accessProfile: "EDITOR" });
    expect(permissions).toEqual(expect.arrayContaining(["view_reports", "export_reports"]));
  });
});

describe("super admin escalations inbox", () => {
  const escalation = (id, anomalyId, createdAt, overrides = {}) => ({
    id,
    testId: TEST_ID,
    createdAt,
    college: { id: COLLEGE_ID, name: "North College", code: "NC" },
    admin: { id: "admin-1", fullName: "Priya Admin", email: "priya@example.test" },
    test: { id: TEST_ID, title: "Aptitude 1", subject: "Quant" },
    afterState: { anomalyId, anomalyType: "TAB_SWITCH", action: "ESCALATE", reason: `Escalated ${anomalyId}` },
    ...overrides,
  });

  const buildDb = ({ rows, anomalyReviews }) => ({
    auditLog: { findMany: jest.fn(async () => rows) },
    test: { findMany: jest.fn(async () => [{ id: TEST_ID, anomalyReviews }]) },
    violation: {
      findMany: jest.fn(async () => [
        { id: "v-pending", type: "TAB_SWITCH", userId: "stu-1", submissionId: "sub-1", timestamp: "2026-09-01T10:00:00.000Z" },
      ]),
    },
    student: { findMany: jest.fn(async () => [{ id: "stu-1", fullName: "Asha Rao", enrollNumber: "NC-042" }]) },
  });

  const rows = [
    escalation("log-3", "v-pending", "2026-09-03T00:00:00.000Z"),
    escalation("log-2", "v-resolved", "2026-09-02T00:00:00.000Z"),
    escalation("log-1", "v-withdrawn", "2026-09-01T00:00:00.000Z"),
    // Older duplicate escalation of the pending anomaly: must be collapsed.
    escalation("log-0", "v-pending", "2026-08-30T00:00:00.000Z"),
  ];
  const anomalyReviews = [
    { anomalyId: "v-pending", action: "ESCALATE", reviewedByAdminId: "admin-1" },
    { anomalyId: "v-resolved", action: "DISMISS", reason: "False positive", reviewedAt: "2026-09-04T00:00:00.000Z", reviewedBySuperAdminId: "super-1" },
    { anomalyId: "v-withdrawn", action: "DISMISS", reviewedByAdminId: "admin-1" },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("derives pending / resolved / withdrawn, collapses duplicates, and counts each", async () => {
    models.init.mockResolvedValue({ dbClient: buildDb({ rows, anomalyReviews }) });

    const response = await invoke(getEscalatedAnomalies, { query: { status: "all" } });

    expect(response.statusCode).toBe(200);
    expect(response.payload.summary).toEqual({ pending: 1, resolved: 1, withdrawn: 1, total: 3 });
    const byAnomaly = Object.fromEntries(response.payload.data.map((item) => [item.anomalyId, item]));
    expect(byAnomaly["v-pending"]).toMatchObject({ id: "log-3", status: "pending", resolution: null });
    expect(byAnomaly["v-resolved"]).toMatchObject({ status: "resolved", resolution: { action: "DISMISS", reason: "False positive" } });
    expect(byAnomaly["v-withdrawn"]).toMatchObject({ status: "withdrawn" });
  });

  it("defaults to the pending queue and attaches the student behind the violation", async () => {
    models.init.mockResolvedValue({ dbClient: buildDb({ rows, anomalyReviews }) });

    const response = await invoke(getEscalatedAnomalies, { query: {} });

    expect(response.payload.data).toHaveLength(1);
    expect(response.payload.data[0]).toMatchObject({
      anomalyId: "v-pending",
      student: { id: "stu-1", name: "Asha Rao", rollNo: "NC-042" },
      violation: { type: "TAB_SWITCH", submissionId: "sub-1" },
      test: { title: "Aptitude 1" },
    });
  });

  it("returns an anomaly to pending when an admin re-escalates after a super decision", async () => {
    const reEscalated = [{ anomalyId: "v-resolved", action: "ESCALATE", reviewedByAdminId: "admin-1" }];
    models.init.mockResolvedValue({ dbClient: buildDb({ rows: [rows[1]], anomalyReviews: reEscalated }) });

    const response = await invoke(getEscalatedAnomalies, { query: { status: "pending" } });

    expect(response.payload.data.map((item) => item.anomalyId)).toEqual(["v-resolved"]);
  });

  it("scopes by college in the query and filters by search text", async () => {
    const db = buildDb({ rows, anomalyReviews });
    models.init.mockResolvedValue({ dbClient: db });

    const response = await invoke(getEscalatedAnomalies, { query: { status: "all", collegeId: COLLEGE_ID, search: "asha" } });

    expect(db.auditLog.findMany.mock.calls[0][0].where).toMatchObject({ action: "REPORT_ANOMALY_ESCALATED", collegeId: COLLEGE_ID });
    expect(response.payload.data.map((item) => item.anomalyId)).toEqual(["v-pending"]);
    expect(response.payload.pagination).toMatchObject({ page: 1, total: 1, totalPages: 1 });
  });
});
