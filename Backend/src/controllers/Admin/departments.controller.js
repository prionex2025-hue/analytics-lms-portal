const models = require("../../models");
const { asyncHandler } = require("../../utils/http");

const getDepartments = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;

  const departments = await db.department.findMany({
    where: { collegeId },
    include: {
      _count: {
        select: {
          batches: true,
          students: true,
          tests: true,
        },
      },
    },
    orderBy: [{ name: "asc" }],
  });

  res.status(200).json(departments);
});

module.exports = {
  getDepartments,
};
