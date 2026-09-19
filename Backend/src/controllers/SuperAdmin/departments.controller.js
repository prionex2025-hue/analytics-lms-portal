const models = require("../../models");
const { createAuditLog } = require("../../services/audit.service");
const { ApiError, asyncHandler } = require("../../utils/http");
const { getPagination } = require("../../utils/pagination");

const parseCsvRecords = (csvText) => {
  const records = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const text = String(csvText || "");

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) records.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  if (row.some(Boolean)) records.push(row);
  return records;
};

const parseCsv = (csvText) => {
  const rows = parseCsvRecords(csvText);

  if (rows.length === 0) return [];

  const headers = rows[0].map((value) => value.trim());
  return rows.slice(1).map((values, rowIndex) => {
    const record = { __row: rowIndex + 2 };
    headers.forEach((key, index) => {
      record[key] = values[index] || "";
    });
    return record;
  });
};

const normalizeColumnKey = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const getRowValue = (row, aliases = []) => {
  const aliasSet = new Set(aliases.map(normalizeColumnKey));
  for (const [key, value] of Object.entries(row || {})) {
    if (aliasSet.has(normalizeColumnKey(key))) {
      return String(value || "").trim();
    }
  }
  return "";
};

const getDepartmentsGlobal = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { page, limit, skip } = getPagination(req.query);
  const collegeId = req.query.collegeId;
  const search = (req.query.search || "").trim();

  const where = {
    ...(collegeId ? { collegeId } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            {
              college: {
                name: { contains: search, mode: "insensitive" },
              },
            },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    db.department.findMany({
      where,
      include: {
        college: true,
        _count: {
          select: {
            batches: true,
            students: true,
            tests: true,
          },
        },
      },
      orderBy: [{ collegeId: "asc" }, { name: "asc" }],
      skip,
      take: limit,
    }),
    db.department.count({ where }),
  ]);

  res.status(200).json({
    data: items,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

const createDepartmentGlobal = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { name, collegeId } = req.body;

  const college = await db.college.findUnique({ where: { id: collegeId } });
  if (!college || !college.isActive) {
    throw new ApiError(400, "Department cannot be created for inactive or missing college");
  }

  const existing = await db.department.findFirst({
    where: {
      collegeId,
      name: {
        equals: name,
        mode: "insensitive",
      },
    },
  });

  if (existing) {
    throw new ApiError(409, "Department with this name already exists in college");
  }

  const department = await db.department.create({
    data: {
      name,
      collegeId,
    },
    include: {
      college: true,
      _count: {
        select: {
          batches: true,
          students: true,
          tests: true,
        },
      },
    },
  });

  await createAuditLog({
    action: "SUPER_ADMIN_CREATE_DEPARTMENT",
    targetType: "DEPARTMENT",
    targetId: department.id,
    collegeId: department.collegeId,
    superAdminId: req.superAdmin.id,
    afterState: {
      id: department.id,
      name: department.name,
      collegeId: department.collegeId,
    },
  });

  res.status(201).json(department);
});

const updateDepartmentGlobal = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { departmentId } = req.params;
  const { name } = req.body;

  const existing = await db.department.findUnique({ where: { id: departmentId } });
  if (!existing) {
    throw new ApiError(404, "Department not found");
  }

  const duplicate = await db.department.findFirst({
    where: {
      collegeId: existing.collegeId,
      id: { not: departmentId },
      name: {
        equals: name,
        mode: "insensitive",
      },
    },
  });

  if (duplicate) {
    throw new ApiError(409, "Department with this name already exists in college");
  }

  const updated = await db.department.update({
    where: { id: departmentId },
    data: { name },
    include: {
      college: true,
      _count: {
        select: {
          batches: true,
          students: true,
          tests: true,
        },
      },
    },
  });

  await createAuditLog({
    action: "SUPER_ADMIN_UPDATE_DEPARTMENT",
    targetType: "DEPARTMENT",
    targetId: updated.id,
    collegeId: updated.collegeId,
    superAdminId: req.superAdmin.id,
    beforeState: existing,
    afterState: {
      id: updated.id,
      name: updated.name,
      collegeId: updated.collegeId,
    },
  });

  res.status(200).json(updated);
});

const deleteDepartmentGlobal = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { departmentId } = req.params;
  const { confirmationText } = req.body;

  const existing = await db.department.findUnique({
    where: { id: departmentId },
    include: {
      _count: {
        select: {
          batches: true,
          students: true,
          tests: true,
        },
      },
    },
  });

  if (!existing) {
    throw new ApiError(404, "Department not found");
  }

  const expectedConfirmation = `DELETE ${existing.name}`;
  if (confirmationText !== expectedConfirmation) {
    throw new ApiError(400, `Typed acknowledgment mismatch. Expected: ${expectedConfirmation}`);
  }

  if ((existing._count?.batches || 0) > 0 || (existing._count?.students || 0) > 0 || (existing._count?.tests || 0) > 0) {
    throw new ApiError(
      409,
      "Cannot delete department with linked records",
      {
        linkedCounts: {
          batches: existing._count?.batches || 0,
          students: existing._count?.students || 0,
          tests: existing._count?.tests || 0,
        },
      },
      "DEPARTMENT_DELETE_BLOCKED"
    );
  }

  await db.department.delete({ where: { id: departmentId } });

  await createAuditLog({
    action: "SUPER_ADMIN_DELETE_DEPARTMENT",
    targetType: "DEPARTMENT",
    targetId: existing.id,
    collegeId: existing.collegeId,
    superAdminId: req.superAdmin.id,
    beforeState: {
      id: existing.id,
      name: existing.name,
      collegeId: existing.collegeId,
    },
  });

  res.status(200).json({ message: "Department deleted" });
});

const bulkImportDepartmentsGlobal = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { csvData, defaultCollegeId } = req.body;
  const rows = parseCsv(csvData);

  if (!rows.length) {
    throw new ApiError(400, "No department rows found in import file");
  }

  const colleges = await db.college.findMany({
    where: { isActive: true },
    select: { id: true, name: true, code: true },
  });

  const byId = new Map(colleges.map((college) => [String(college.id), college]));
  const byCode = new Map(colleges.map((college) => [String(college.code || "").toLowerCase(), college]));
  const byName = new Map(colleges.map((college) => [String(college.name || "").toLowerCase(), college]));

  const result = {
    created: 0,
    failed: 0,
    duplicates: 0,
    errors: [],
  };

  const fallbackCollege = defaultCollegeId ? byId.get(String(defaultCollegeId)) : null;
  if (defaultCollegeId && !fallbackCollege) {
    throw new ApiError(400, "Default college is missing or inactive");
  }

  for (const row of rows) {
    const departmentName = getRowValue(row, ["name", "department", "departmentName", "department_name"]);
    const collegeIdInput = getRowValue(row, ["collegeId", "college_id"]);
    const collegeCodeInput = getRowValue(row, ["collegeCode", "college_code", "code"]);
    const collegeNameInput = getRowValue(row, ["collegeName", "college_name", "college"]);

    if (!departmentName) {
      result.failed += 1;
      result.errors.push({ row: row.__row, reason: "Department name is required" });
      continue;
    }

    const resolvedCollege =
      (collegeIdInput ? byId.get(String(collegeIdInput)) : null)
      || (collegeCodeInput ? byCode.get(String(collegeCodeInput).toLowerCase()) : null)
      || (collegeNameInput ? byName.get(String(collegeNameInput).toLowerCase()) : null)
      || fallbackCollege
      || null;

    if (!resolvedCollege) {
      result.failed += 1;
      result.errors.push({ row: row.__row, reason: "Unable to resolve college (collegeId/collegeCode/collegeName/defaultCollegeId)" });
      continue;
    }

    const existing = await db.department.findFirst({
      where: {
        collegeId: resolvedCollege.id,
        name: {
          equals: departmentName,
          mode: "insensitive",
        },
      },
      select: { id: true },
    });

    if (existing) {
      result.duplicates += 1;
      result.errors.push({ row: row.__row, reason: "Duplicate department for selected college" });
      continue;
    }

    await db.department.create({
      data: {
        name: departmentName,
        collegeId: resolvedCollege.id,
      },
    });

    result.created += 1;
  }

  await createAuditLog({
    action: "SUPER_ADMIN_BULK_IMPORT_DEPARTMENTS",
    targetType: "DEPARTMENT_IMPORT",
    targetId: `DEPT_IMPORT_${Date.now()}`,
    superAdminId: req.superAdmin.id,
    afterState: {
      defaultCollegeId: fallbackCollege?.id || null,
      summary: result,
    },
  });

  res.status(200).json({
    message: "Department bulk import processed",
    result,
  });
});

module.exports = {
  getDepartmentsGlobal,
  createDepartmentGlobal,
  updateDepartmentGlobal,
  deleteDepartmentGlobal,
  bulkImportDepartmentsGlobal,
};
