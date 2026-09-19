const models = require("../../models");
const { ApiError, asyncHandler } = require("../../utils/http");

const getSubjects = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;

  const subjects = await db.subject.findMany({
    where: {
      collegeId,
      resourceSubjectScope: { not: { in: ["GLOBAL", "COLLEGE"] } },
    },
    include: {
      createdByAdmin: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  const subjectIds = subjects.map((item) => item.id);
  const counts = subjectIds.length
    ? await Promise.all(
        subjectIds.map((subjectId) =>
          db.questionBank.count({
            where: { collegeId, subjectId, isActive: { not: false } },
          })
        )
      )
    : [];

  res.status(200).json(
    subjects.map((subject, index) => ({
      ...subject,
      questionCount: counts[index] || 0,
      lastUpdated: subject.updatedAt || subject.createdAt,
    }))
  );
});

const createSubject = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const name = String(req.body?.name || "").trim();

  if (!name) {
    throw new ApiError(422, "Subject name is required");
  }

  const exists = await db.subject.findFirst({
    where: {
      collegeId,
      resourceSubjectScope: { not: { in: ["GLOBAL", "COLLEGE"] } },
      name: { equals: name, mode: "insensitive" },
    },
  });

  if (exists) {
    throw new ApiError(409, "Subject already exists");
  }

  const subject = await db.subject.create({
    data: {
      collegeId,
      name,
      createdByAdminId: req.admin.id,
      questionSubjectScope: "COLLEGE",
    },
  });

  res.status(201).json(subject);
});

const deleteSubject = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const { id } = req.params;

  const subject = await db.subject.findFirst({
    where: {
      id,
      collegeId,
      resourceSubjectScope: { not: { in: ["GLOBAL", "COLLEGE"] } },
    },
  });

  if (!subject) {
    throw new ApiError(404, "Subject not found");
  }

  const linkedQuestions = await db.questionBank.count({
    where: { collegeId, subjectId: id },
  });

  if (linkedQuestions > 0) {
    throw new ApiError(409, "Cannot delete subject with existing questions", { questionCount: linkedQuestions }, "SUBJECT_IN_USE");
  }

  await db.subject.delete({ where: { id } });

  res.status(200).json({ message: "Subject deleted" });
});

module.exports = {
  getSubjects,
  createSubject,
  deleteSubject,
};
