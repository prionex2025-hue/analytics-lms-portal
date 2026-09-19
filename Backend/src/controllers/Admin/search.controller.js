const models = require("../../models");
const { asyncHandler } = require("../../utils/http");
const { getScopedDepartmentId } = require("../../utils/admin-scope");

const hasAnyPermission = (permissions, ...required) =>
  required.some((permission) => permissions.has(permission));

const mapResults = (type, items) =>
  items.map((item) => ({
    id: item.id,
    type,
    title: item.title || item.name || item.fullName || item.rollNumber || item.studentId,
    subtitle:
      type === "student"
        ? item.rollNumber || item.studentId || item.email || ""
        : type === "test"
          ? item.subject || item.status || ""
          : type === "batch"
            ? item.academicYear || ""
            : item.eventDate || item.type || "",
    path:
      type === "student"
        ? "/admin/students"
        : type === "test"
          ? "/admin/tests"
          : type === "batch"
            ? "/admin/batches"
            : "/admin/events",
  }));

const adminSearch = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const q = String(req.query.q || "").trim();

  if (q.length < 2) {
    return res.status(200).json({ data: [] });
  }

  const permissions = new Set(Array.isArray(req.admin?.permissions) ? req.admin.permissions : []);
  const canSearchTests = hasAnyPermission(permissions, "edit_test", "manage_questions", "view_tests");
  const canSearchStudents = hasAnyPermission(permissions, "manage_students", "view_students");
  const canSearchBatches = hasAnyPermission(permissions, "manage_batches", "view_batches");
  const canSearchEvents = hasAnyPermission(permissions, "manage_events", "view_events");
  const whereCollege = req.collegeFilter || { collegeId: req.collegeId };
  const departmentId = getScopedDepartmentId(req, { requiredForDepartmentAdmin: false });
  const departmentBatchIds = departmentId && canSearchTests
    ? (await db.batch.findMany({
        where: { ...whereCollege, departmentId },
        select: { id: true },
      })).map((batch) => batch.id)
    : [];
  const studentScope = departmentId ? { ...whereCollege, departmentId } : whereCollege;
  const batchScope = departmentId ? { ...whereCollege, departmentId } : whereCollege;
  const testScope = departmentId
    ? {
        AND: [
          whereCollege,
          {
            OR: [
              { departmentId },
              { assignedTo: { in: [departmentId] } },
              ...(departmentBatchIds.length > 0
                ? [
                    { batchId: { in: departmentBatchIds } },
                    { batchAssignments: { some: { batchId: { in: departmentBatchIds } } } },
                  ]
                : []),
            ],
          },
        ],
      }
    : whereCollege;

  const [tests, students, batches, events] = await Promise.all([
    canSearchTests
      ? db.test.findMany({
          where: {
            AND: [
              testScope,
              { OR: [{ title: { contains: q, mode: "insensitive" } }, { subject: { contains: q, mode: "insensitive" } }] },
            ],
          },
          select: { id: true, title: true, subject: true, status: true },
          take: 8,
          orderBy: { updatedAt: "desc" },
        })
      : Promise.resolve([]),
    canSearchStudents
      ? db.student.findMany({
          where: {
            AND: [
              studentScope,
              {
                OR: [
                  { fullName: { contains: q, mode: "insensitive" } },
                  { studentId: { contains: q, mode: "insensitive" } },
                  { email: { contains: q, mode: "insensitive" } },
                ],
              },
            ],
          },
          select: { id: true, fullName: true, studentId: true, email: true },
          take: 8,
          orderBy: { updatedAt: "desc" },
        })
      : Promise.resolve([]),
    canSearchBatches
      ? db.batch.findMany({
          where: {
            AND: [
              batchScope,
              { name: { contains: q, mode: "insensitive" } },
            ],
          },
          select: { id: true, name: true, academicYear: true },
          take: 8,
          orderBy: { updatedAt: "desc" },
        })
      : Promise.resolve([]),
    canSearchEvents
      ? db.event.findMany({
          where: {
            ...whereCollege,
            OR: [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }],
          },
          select: { id: true, name: true, eventDate: true, type: true },
          take: 8,
          orderBy: { updatedAt: "desc" },
        })
      : Promise.resolve([]),
  ]);

  const data = [
    ...mapResults("test", tests),
    ...mapResults("student", students),
    ...mapResults("batch", batches),
    ...mapResults("event", events),
  ];

  res.status(200).json({ data });
});

module.exports = {
  adminSearch,
};
