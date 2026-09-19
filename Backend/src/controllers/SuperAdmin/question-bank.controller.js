const models = require("../../models");
const { ApiError, asyncHandler } = require("../../utils/http");
const { getPagination } = require("../../utils/pagination");

const mapQuestionType = (type) => {
  const map = {
    mcq: "MCQ",
    true_false: "TRUE_FALSE",
    fill_blank: "FILL_BLANK",
    paragraph: "PARAGRAPH",
  };
  return map[type];
};

const normalizeOptionalUrl = (value) => {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
};

const normalizeOptionalCategory = (value) => {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
};

const assertQuestionSubject = async (db, { subjectId, superAdminId }) => {
  const subject = await db.subject.findFirst({
    where: {
      id: subjectId,
      createdBySuperAdminId: superAdminId,
      resourceSubjectScope: { not: { in: ["GLOBAL", "COLLEGE"] } },
    },
  });

  if (!subject) {
    throw new ApiError(422, "Question bank subject is invalid");
  }

  return subject;
};

/**
 * Super Admin Question Bank Controller
 * Questions created here belong to the super admin (createdBySuperAdminId).
 * They are global — no college scope required.
 * Super admins can optionally assign a collegeId for college-targeted question banks.
 */

const addQuestionBankItem = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const superAdminId = req.superAdmin.id;

  if (!req.body.subjectId && !req.body.subject) {
    throw new ApiError(422, "subjectId or subject is required");
  }

  let subjectId = req.body.subjectId || null;
  if (!subjectId) {
    const existingSubject = await db.subject.findFirst({
      where: {
        createdBySuperAdminId: superAdminId,
        resourceSubjectScope: { not: { in: ["GLOBAL", "COLLEGE"] } },
        name: { equals: String(req.body.subject || "").trim(), mode: "insensitive" },
      },
    });

    if (existingSubject) {
      subjectId = existingSubject.id;
    } else {
      const createdSubject = await db.subject.create({
        data: {
          name: String(req.body.subject || "").trim(),
          collegeId: req.body.collegeId || null,
          createdBySuperAdminId: superAdminId,
          questionSubjectScope: "GLOBAL",
        },
      });
      subjectId = createdSubject.id;
    }
  } else {
    await assertQuestionSubject(db, { subjectId, superAdminId });
  }

  const item = await db.questionBank.create({
    data: {
      collegeId: req.body.collegeId || null,
      subjectId,
      subject: req.body.subject || null,
      difficulty: req.body.difficulty,
      prompt: req.body.question,
      type: mapQuestionType(req.body.type),
      options: req.body.options || [],
      correctOption: req.body.type === "mcq" ? String(req.body.correctAnswer) : null,
      correctBoolean: req.body.type === "true_false" ? Boolean(req.body.correctAnswer) : null,
      correctText: req.body.type === "fill_blank" || req.body.type === "paragraph" ? String(req.body.correctAnswer) : null,
      marks: req.body.marks,
      explanationVideoUrl: normalizeOptionalUrl(req.body.explanationVideoUrl),
      tags: Array.isArray(req.body.tags) ? req.body.tags : [],
      category: normalizeOptionalCategory(req.body.category),
      usageCount: 0,
      isActive: true,
      createdBySuperAdminId: superAdminId,
    },
    include: {
      createdBySuperAdmin: true,
      subjectRef: true,
    },
  });

  res.status(201).json(item);
});

const getQuestionBank = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const superAdminId = req.superAdmin.id;
  const { page, limit, skip } = getPagination(req.query);

  const fromDate = req.query.fromDate ? new Date(req.query.fromDate) : null;
  const toDate = req.query.toDate ? new Date(req.query.toDate) : null;

  let typeFilter = null;
  if (req.query.type) {
    typeFilter = mapQuestionType(req.query.type);
  }

  const where = {
    createdBySuperAdminId: superAdminId,
    ...(req.query.subjectId ? { subjectId: req.query.subjectId } : {}),
    ...(req.query.subject ? { subject: { equals: req.query.subject, mode: "insensitive" } } : {}),
    ...(req.query.difficulty ? { difficulty: req.query.difficulty } : {}),
    ...(typeFilter ? { type: typeFilter } : {}),
    ...(req.query.category ? { category: req.query.category } : {}),
    ...(req.query.search
      ? {
          prompt: {
            contains: req.query.search,
            mode: "insensitive",
          },
        }
      : {}),
    ...(fromDate || toDate
      ? {
          createdAt: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lte: toDate } : {}),
          },
        }
      : {}),
  };

  const [total, data] = await Promise.all([
    db.questionBank.count({ where }),
    db.questionBank.findMany({
      where,
      include: {
        createdBySuperAdmin: true,
        subjectRef: true,
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
  ]);

  res.status(200).json({
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

const exportQuestionBankJson = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const superAdminId = req.superAdmin.id;

  const items = await db.questionBank.findMany({
    where: { createdBySuperAdminId: superAdminId },
    include: {
      createdBySuperAdmin: true,
      subjectRef: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const payload = items.map((item) => ({
    type: String(item.type).toLowerCase(),
    question: item.prompt,
    options: item.options,
    correctAnswer: item.correctOption || item.correctText || item.correctBoolean,
    marks: item.marks,
    difficulty: item.difficulty,
    subject: item.subject,
    subjectId: item.subjectId,
    category: item.category || null,
    explanationVideoUrl: item.explanationVideoUrl || null,
    tags: item.tags || [],
    isActive: item.isActive,
  }));

  res.status(200).json(payload);
});

const importQuestionBankJson = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const superAdminId = req.superAdmin.id;
  const items = req.body.items;

  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(422, "items[] is required");
  }

  const data = items.map((item) => {
    if (!item.question || String(item.question).trim() === "") {
      throw new ApiError(422, "No empty questions allowed");
    }

    if (item.type === "mcq" && !Array.isArray(item.options)) {
      throw new ApiError(422, "MCQ options are required");
    }

    if (item.correctAnswer === undefined || item.correctAnswer === null || item.correctAnswer === "") {
      throw new ApiError(422, "correctAnswer is required");
    }

    return {
      collegeId: item.collegeId || null,
      subjectId: item.subjectId || null,
      subject: item.subject || "General",
      difficulty: item.difficulty || "MEDIUM",
      prompt: item.question,
      type: mapQuestionType(item.type),
      options: item.options || [],
      correctOption: item.type === "mcq" ? String(item.correctAnswer) : null,
      correctBoolean: item.type === "true_false" ? Boolean(item.correctAnswer) : null,
      correctText: item.type === "fill_blank" || item.type === "paragraph" ? String(item.correctAnswer) : null,
      marks: item.marks || 1,
      explanationVideoUrl: normalizeOptionalUrl(item.explanationVideoUrl),
      tags: Array.isArray(item.tags) ? item.tags : [],
      category: normalizeOptionalCategory(item.category),
      usageCount: 0,
      isActive: item.isActive !== false,
      createdBySuperAdminId: superAdminId,
    };
  });

  await db.questionBank.createMany({
    data,
    skipDuplicates: true,
  });

  res.status(201).json({ message: "Question bank import complete", count: data.length });
});

const updateQuestionBankItem = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const superAdminId = req.superAdmin.id;
  const { id } = req.params;

  const existing = await db.questionBank.findFirst({
    where: { id, createdBySuperAdminId: superAdminId },
  });

  if (!existing) {
    throw new ApiError(404, "Question not found");
  }

  const type = req.body.type || String(existing.type || "").toLowerCase();
  const subjectId = req.body.subjectId || existing.subjectId || null;
  if (subjectId) {
    await assertQuestionSubject(db, { subjectId, superAdminId });
  }

  const updated = await db.questionBank.update({
    where: { id },
    data: {
      subjectId,
      subject: req.body.subject || existing.subject || null,
      difficulty: req.body.difficulty || existing.difficulty,
      type: req.body.type ? mapQuestionType(req.body.type) : existing.type,
      prompt: req.body.question || existing.prompt,
      options: Array.isArray(req.body.options) ? req.body.options : existing.options,
      correctOption:
        type === "mcq"
          ? String(req.body.correctAnswer ?? existing.correctOption ?? "")
          : null,
      correctBoolean:
        type === "true_false"
          ? Boolean(req.body.correctAnswer ?? existing.correctBoolean)
          : null,
      correctText:
        type === "fill_blank" || type === "paragraph"
          ? String(req.body.correctAnswer ?? existing.correctText ?? "")
          : null,
      marks: req.body.marks || existing.marks,
      explanationVideoUrl:
        req.body.explanationVideoUrl !== undefined
          ? normalizeOptionalUrl(req.body.explanationVideoUrl)
          : existing.explanationVideoUrl ?? null,
      tags: Array.isArray(req.body.tags) ? req.body.tags : existing.tags || [],
      isActive: typeof req.body.isActive === "boolean" ? req.body.isActive : existing.isActive,
      category: req.body.category !== undefined ? normalizeOptionalCategory(req.body.category) : existing.category,
    },
    include: {
      createdBySuperAdmin: true,
      subjectRef: true,
    },
  });

  res.status(200).json(updated);
});

const deleteQuestionBankItem = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const superAdminId = req.superAdmin.id;
  const { id } = req.params;

  const existing = await db.questionBank.findFirst({
    where: { id, createdBySuperAdminId: superAdminId },
  });

  if (!existing) {
    throw new ApiError(404, "Question not found");
  }

  if (Number(existing.usageCount || 0) > 0) {
    throw new ApiError(409, "Question already used in tests and cannot be deleted", null, "QUESTION_IN_USE");
  }

  await db.questionBank.delete({ where: { id } });

  res.status(200).json({ message: "Question deleted" });
});

module.exports = {
  addQuestionBankItem,
  getQuestionBank,
  exportQuestionBankJson,
  importQuestionBankJson,
  updateQuestionBankItem,
  deleteQuestionBankItem,
};
