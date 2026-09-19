const models = require("../../models");
const { createAuditLog } = require("../../services/audit.service");
const { ApiError, asyncHandler } = require("../../utils/http");
const { getPagination } = require("../../utils/pagination");
const { ROLES } = require("../../constants/roles");
const { resolvePermissionsForRole } = require("../../constants/admin-access-profiles");

const hydrateCollegeAdminSummary = async ({ db, colleges }) => {
  if (!Array.isArray(colleges) || colleges.length === 0) {
    return [];
  }

  const collegeIds = colleges.map((college) => college.id);
  const admins = await db.admin.findMany({
    where: {
      collegeId: { in: collegeIds },
      isActive: true,
      role: { in: [ROLES.ADMIN, ROLES.COLLEGE_ADMIN] },
    },
    select: {
      id: true,
      collegeId: true,
      fullName: true,
      email: true,
      role: true,
    },
  });

  const byCollege = new Map();
  for (const admin of admins) {
    const key = String(admin.collegeId);
    const current = byCollege.get(key) || { totalAdmins: 0, collegeAdmins: [] };
    if (admin.role === ROLES.ADMIN) {
      current.totalAdmins += 1;
    }
    if (admin.role === ROLES.COLLEGE_ADMIN) {
      current.collegeAdmins.push({
        id: admin.id,
        fullName: admin.fullName,
        email: admin.email,
      });
    }
    byCollege.set(key, current);
  }

  return colleges.map((college) => {
    const summary = byCollege.get(String(college.id)) || { totalAdmins: 0, collegeAdmins: [] };
    const hasExplicitAssignmentField = Object.prototype.hasOwnProperty.call(college, "collegeAdminId");
    const assignedById = summary.collegeAdmins.find(
      (admin) => String(admin.id) === String(college.collegeAdminId || "")
    );
    const fallbackAssigned = hasExplicitAssignmentField ? null : summary.collegeAdmins[0] || null;

    return {
      ...college,
      totalAdmins: summary.totalAdmins,
      assignedCollegeAdmin: assignedById || fallbackAssigned || null,
    };
  });
};

const getColleges = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const search = (req.query.search || "").trim();

  const where = {
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { code: { contains: search, mode: "insensitive" } },
            { location: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const m = await models.init();
  const College = m.dbClient.college;

  const [items, total] = await Promise.all([
    College.findMany({
      where,
      include: {
        _count: {
          select: {
            departments: true,
            admins: true,
            students: true,
            tests: true,
            batches: true,
            questionBankItems: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    College.count({ where }),
  ]);

  const enrichedItems = await hydrateCollegeAdminSummary({
    db: m.dbClient,
    colleges: items,
  });

  res.status(200).json({
    data: enrichedItems,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});
const getCollege = asyncHandler(async (req, res) => {
  const { collegeId } = req.params;

  const m = await models.init();
  const College = m.dbClient.college;

  const college = await College.findUnique({
    where: { id: collegeId },
    include: {
      _count: {
        select: {
          departments: true,
          admins: true,
          students: true,
          tests: true,
          batches: true,
          questionBankItems: true,
        },
      },
    },
  });

  if (!college) {
    throw new ApiError(404, "College not found");
  }

  const [enrichedCollege] = await hydrateCollegeAdminSummary({
    db: m.dbClient,
    colleges: [college],
  });

  res.status(200).json(enrichedCollege);
});

const createCollege = asyncHandler(async (req, res) => {
  const m = await models.init();
  const College = m.dbClient.college;

  const college = await College.create({
    data: {
      name: req.body.name,
      code: req.body.code,
      location: req.body.location || null,
      collegeAdminId: null,
      isActive: true,
    },
  });

  await createAuditLog({
    action: "SUPER_ADMIN_CREATE_COLLEGE",
    targetType: "COLLEGE",
    targetId: college.id,
    superAdminId: req.superAdmin.id,
    afterState: college,
  });

  res.status(201).json(college);
});

const updateCollege = asyncHandler(async (req, res) => {
  const { collegeId } = req.params;

  const m = await models.init();
  const College = m.dbClient.college;
  const Admin = m.dbClient.admin;

  const existing = await College.findUnique({ where: { id: collegeId } });
  if (!existing) {
    throw new ApiError(404, "College not found");
  }

  if (req.body.isActive === false) {
    const expectedConfirmation = `SUSPEND ${existing.code || existing.id}`;
    if (req.body?.confirmationText !== expectedConfirmation) {
      throw new ApiError(400, `Typed acknowledgment mismatch. Expected: ${expectedConfirmation}`);
    }
  }

  const hasCollegeAdminAssignment = Object.prototype.hasOwnProperty.call(req.body || {}, "collegeAdminId");
  let assignedCollegeAdminId = existing.collegeAdminId || null;
  const reassignedAdmins = [];

  if (hasCollegeAdminAssignment) {
    const candidateCollegeAdminId = req.body.collegeAdminId || null;

    if (!candidateCollegeAdminId) {
      assignedCollegeAdminId = null;
    } else {
      const nextCollegeAdmin = await Admin.findFirst({
        where: {
          id: candidateCollegeAdminId,
          collegeId,
          isActive: true,
        },
      });

      if (!nextCollegeAdmin) {
        throw new ApiError(404, "Selected college admin was not found in this college");
      }

      if (nextCollegeAdmin.role !== ROLES.COLLEGE_ADMIN) {
        await Admin.update({
          where: { id: nextCollegeAdmin.id },
          data: {
            role: ROLES.COLLEGE_ADMIN,
            departmentId: null,
            permissions: resolvePermissionsForRole(ROLES.COLLEGE_ADMIN, nextCollegeAdmin.accessProfile),
          },
        });
      }

      const otherCollegeAdmins = await Admin.findMany({
        where: {
          collegeId,
          role: ROLES.COLLEGE_ADMIN,
          isActive: true,
          id: { not: nextCollegeAdmin.id },
        },
        select: {
          id: true,
          fullName: true,
        },
      });

      if (otherCollegeAdmins.length > 0) {
        await Admin.updateMany({
          where: {
            id: { in: otherCollegeAdmins.map((item) => item.id) },
            role: ROLES.COLLEGE_ADMIN,
          },
          data: {
            isActive: false,
          },
        });
        reassignedAdmins.push(...otherCollegeAdmins.map((item) => ({ id: item.id, fullName: item.fullName })));
      }

      assignedCollegeAdminId = nextCollegeAdmin.id;
    }
  }

  const college = await College.update({
    where: { id: collegeId },
    data: {
      ...(req.body.name !== undefined ? { name: req.body.name } : {}),
      ...(req.body.code !== undefined ? { code: req.body.code } : {}),
      ...(req.body.location !== undefined ? { location: req.body.location } : {}),
      ...(req.body.isActive !== undefined ? { isActive: req.body.isActive } : {}),
      ...(req.body.isActive === false ? { deletedAt: new Date() } : {}),
      ...(req.body.isActive === true ? { deletedAt: null } : {}),
      ...(hasCollegeAdminAssignment ? { collegeAdminId: assignedCollegeAdminId } : {}),
    },
  });

  const [enrichedCollege] = await hydrateCollegeAdminSummary({
    db: m.dbClient,
    colleges: [college],
  });

  await createAuditLog({
    action: "SUPER_ADMIN_UPDATE_COLLEGE",
    targetType: "COLLEGE",
    targetId: college.id,
    superAdminId: req.superAdmin.id,
    beforeState: existing,
    afterState: {
      ...college,
      reassignedAdmins,
    },
  });

  res.status(200).json({
    ...enrichedCollege,
    reassignedAdmins,
  });
});

const deactivateCollege = asyncHandler(async (req, res) => {
  const { collegeId } = req.params;

  const m = await models.init();
  const College = m.dbClient.college;

  const existing = await College.findUnique({ where: { id: collegeId } });
  if (!existing) {
    throw new ApiError(404, "College not found");
  }

  const college = await College.update({
    where: { id: collegeId },
    data: {
      isActive: false,
      deletedAt: new Date(),
    },
  });

  await createAuditLog({
    action: "SUPER_ADMIN_DEACTIVATE_COLLEGE",
    targetType: "COLLEGE",
    targetId: college.id,
    superAdminId: req.superAdmin.id,
    beforeState: existing,
    afterState: college,
  });

  res.status(200).json({ message: "College deactivated", college });
});

module.exports = {
  getColleges,
  getCollege,
  createCollege,
  updateCollege,
  deactivateCollege,
};
