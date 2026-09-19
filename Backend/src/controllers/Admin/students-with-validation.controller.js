/**
 * Admin Students Controller with Validation Integration
 * 
 * This controller integrates student.service for all CRUD operations.
 * Usage: Replace existing controller imports with this one to enable validation.
 */

const models = require("../../models");
const { asyncHandler, ApiError } = require("../../utils/http");
const {
  createStudent,
  updateStudent,
  bulkImportStudents: bulkImportStudentsService,
  toggleStudentStatus,
} = require("../../services/student.service");
const { getMetricsSnapshot } = require("../../services/validation-monitoring.service");
const { getPagination } = require("../../utils/pagination");
const { getScopedDepartmentId } = require("../../utils/admin-scope");
const { appendLifecycleFilters } = require("../../services/report-scope.service");

const parseCsv = (csvText) => {
  const rows = String(csvText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (rows.length === 0) return [];

  const headers = rows[0].split(",").map((value) => value.trim().toLowerCase());
  return rows.slice(1).map((line, rowIndex) => {
    const values = line.split(",").map((value) => value.trim());
    const record = { __row: rowIndex + 2 };
    headers.forEach((key, index) => {
      record[key] = values[index] || "";
    });
    return record;
  });
};

/**
 * Get all students with pagination and filters
 */
const getStudents = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const { page, limit, skip } = getPagination(req.query);
  const scopedDepartmentId = getScopedDepartmentId(req, { requiredForDepartmentAdmin: false });

  const baseWhere = {
    collegeId,
    ...(scopedDepartmentId
      ? { departmentId: scopedDepartmentId }
      : (req.query.departmentId ? { departmentId: req.query.departmentId } : {})),
  };
  const where = req.query.studentScope ? appendLifecycleFilters(baseWhere, req.query) : baseWhere;

  const filters = [];
  if (req.query.batchId) {
    filters.push({
      OR: [
        { batchIds: { in: [req.query.batchId] } },
        { batchId: req.query.batchId },
      ],
    });
  }

  if (req.query.search) {
    filters.push({
      OR: [
        { fullName: { contains: req.query.search, mode: "insensitive" } },
        { email: { contains: req.query.search, mode: "insensitive" } },
        { studentId: { contains: req.query.search, mode: "insensitive" } },
        { department: { name: { contains: req.query.search, mode: "insensitive" } } },
      ],
    });
  }

  if (req.query.year) {
    const year = Number(req.query.year);
    if (Number.isInteger(year) && year >= 1 && year <= 4) {
      filters.push({ year });
    }
  }

  if (filters.length > 0) {
    where.AND = filters;
  }

  const [total, data] = await Promise.all([
    db.student.count({ where }),
    db.student.findMany({
      where,
      include: {
        batches: true,
        department: true,
        _count: {
          select: {
            submissions: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
  ]);

  const normalized = data.map((student) => {
    const mergedBatchIds = [...new Set([
      ...(Array.isArray(student.batchIds) ? student.batchIds : []),
      student.batchId,
    ].filter(Boolean).map((id) => String(id)))];

    return {
      ...student,
      batchIds: mergedBatchIds,
      batch: student.batch || (Array.isArray(student.batches) ? student.batches[0] : null),
    };
  });

  res.status(200).json({
    data: normalized,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

/**
 * Create single student with validation
 */
const createStudentHandler = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const adminId = req.admin.id;

  try {
    const student = await createStudent(
      {
        fullName: req.body.fullName,
        email: req.body.email,
        enrollmentNumber: req.body.enrollNumber,
        year: req.body.year,
        departmentId: req.body.departmentId,
        batchId: req.body.batchId,
      },
      collegeId,
      adminId
    );

    res.status(201).json({
      success: true,
      student,
      message: "Student created successfully",
    });
  } catch (error) {
    if (error.statusCode === 422) {
      // Validation error with details
      return res.status(422).json({
        success: false,
        error: error.message,
        details: error.details,
        code: error.errorCode,
      });
    }
    throw error;
  }
});

/**
 * Bulk import students from CSV with validation
 */
const bulkImportStudentsHandler = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const adminId = req.admin.id;

  if (!req.body.csvData) {
    throw new ApiError(400, "CSV data is required");
  }

  const rows = parseCsv(req.body.csvData);
  if (rows.length === 0) {
    throw new ApiError(400, "No valid rows in CSV");
  }

  try {
    // Call the service with proper field mapping
    const result = await bulkImportStudentsService(
      rows.map((row) => ({
        fullName: row.fullname || row.name || "",
        email: row.email || "",
        enrollmentNumber: row.enrollnumber || row.enroll_number || "",
        year: row.year || "",
        departmentId: row.departmentid || "",
        batchId: row.batchid || null,
      })),
      collegeId,
      adminId
    );

    res.status(200).json({
      success: true,
      message: "Bulk import completed",
      result,
      metrics: await getMetricsSnapshot(), // Include validation metrics
    });
  } catch (error) {
    // Return validation errors with detailed context
    res.status(400).json({
      success: false,
      error: error.message,
      details: error.details,
      code: error.errorCode,
      metrics: await getMetricsSnapshot(),
    });
  }
});

/**
 * Update student with validation
 */
const updateStudentHandler = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const adminId = req.admin.id;
  const { studentId } = req.params;

  try {
    const student = await updateStudent(
      studentId,
      req.body,
      collegeId,
      adminId
    );

    res.status(200).json({
      success: true,
      student,
      message: "Student updated successfully",
    });
  } catch (error) {
    if (error.statusCode === 422) {
      return res.status(422).json({
        success: false,
        error: error.message,
        details: error.details,
        code: error.errorCode,
      });
    }
    throw error;
  }
});

/**
 * Toggle student status (active/inactive)
 */
const toggleStudentStatusHandler = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const adminId = req.admin.id;
  const { studentId } = req.params;
  const { isActive } = req.body;

  try {
    const student = await toggleStudentStatus(
      studentId,
      collegeId,
      adminId,
      isActive
    );

    res.status(200).json({
      success: true,
      student,
      message: `Student ${isActive ? "activated" : "deactivated"} successfully`,
    });
  } catch (error) {
    throw error;
  }
});

/**
 * Get validation metrics for student operations
 */
const getStudentMetrics = asyncHandler(async (req, res) => {
  const metrics = await getMetricsSnapshot();
  const studentMetrics = metrics.failures?.UserValidation || {};

  res.status(200).json({
    total_validations: metrics.summary.total,
    successful: metrics.summary.passed,
    failed: metrics.summary.failed,
    success_rate: metrics.summary.successRate,
    student_failures: {
      count: studentMetrics.count || 0,
      recent_errors: (studentMetrics.errors || []).slice(0, 5),
    },
    latency_ms: metrics.latency?.UserValidation || {},
  });
});

module.exports = {
  getStudents,
  createStudentHandler,
  bulkImportStudentsHandler,
  updateStudentHandler,
  toggleStudentStatusHandler,
  getStudentMetrics,
};
