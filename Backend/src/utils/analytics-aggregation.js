const mongoose = require("mongoose");

const normalizeMongoId = (value) => {
  if (value == null) return "";
  return String(value);
};

const toObjectIdIfValid = (value) => {
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  const text = String(value || "").trim();
  return mongoose.Types.ObjectId.isValid(text) ? new mongoose.Types.ObjectId(text) : value;
};

const scorePercentExpression = {
  $let: {
    vars: {
      score: { $convert: { input: "$score", to: "double", onError: 0, onNull: 0 } },
      totalMarks: { $convert: { input: "$test.totalMarks", to: "double", onError: 0, onNull: 0 } },
      accuracy: { $convert: { input: "$accuracy", to: "double", onError: 0, onNull: 0 } },
    },
    in: {
      $min: [
        100,
        {
          $max: [
            0,
            {
              $cond: [
                { $gt: ["$$totalMarks", 0] },
                { $multiply: [{ $divide: ["$$score", "$$totalMarks"] }, 100] },
                "$$accuracy",
              ],
            },
          ],
        },
      ],
    },
  },
};

const withSubmissionScorePercent = () => [
  {
    $lookup: {
      from: "test",
      localField: "testId",
      foreignField: "_id",
      as: "test",
    },
  },
  { $unwind: { path: "$test", preserveNullAndEmptyArrays: true } },
  { $addFields: { scorePercent: scorePercentExpression } },
];

module.exports = {
  normalizeMongoId,
  scorePercentExpression,
  toObjectIdIfValid,
  withSubmissionScorePercent,
};
