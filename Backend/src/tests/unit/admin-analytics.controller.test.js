const mongoose = require("mongoose");

const { getCollegeAnalytics } = require("../../controllers/Admin/analytics.controller");

const invoke = async (handler, req = {}) =>
  new Promise((resolve, reject) => {
    const res = {
      status: jest.fn(function status(code) {
        this.statusCode = code;
        return this;
      }),
      json: jest.fn((payload) => {
        resolve({ res, payload });
      }),
    };

    handler(req, res, (error) => {
      if (error) {
        reject(error);
      }
    });
  });

describe("admin analytics controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("derives score percent from joined test total marks in submission analytics", async () => {
    const submissionPipelines = [];
    const submissionAggregate = jest.fn((pipeline) => {
      submissionPipelines.push(pipeline);
      return {
        toArray: async () => [],
      };
    });

    mongoose.connection.db = {
      collection: (name) => {
        if (name === "submission") {
          return {
            countDocuments: jest.fn(async () => 0),
            distinct: jest.fn(async () => []),
            aggregate: submissionAggregate,
          };
        }

        return {
          countDocuments: jest.fn(async () => 0),
          aggregate: jest.fn(() => ({ toArray: async () => [] })),
        };
      },
    };

    const collegeId = new mongoose.Types.ObjectId().toHexString();
    const { payload } = await invoke(getCollegeAnalytics, { collegeId });

    expect(payload.overview.averageScore).toBe(0);
    expect(payload.modulePerformance).toEqual([]);
    expect(submissionAggregate).toHaveBeenCalledTimes(7);
    expect(submissionPipelines).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.objectContaining({
            $lookup: expect.objectContaining({
              from: "test",
              localField: "testId",
              foreignField: "_id",
            }),
          }),
          expect.objectContaining({
            $addFields: expect.objectContaining({
              scorePercent: expect.objectContaining({ $let: expect.any(Object) }),
            }),
          }),
        ]),
      ])
    );
    expect(JSON.stringify(submissionPipelines)).not.toContain('"$ifNull":["$accuracy",0]');
  });
});
