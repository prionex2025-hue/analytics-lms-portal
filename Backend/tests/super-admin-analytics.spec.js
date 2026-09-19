const mongoose = require("mongoose");

// Ensure we can modify the connection.db stub
mongoose.connection = mongoose.connection || {};

describe("SuperAdmin analytics aggregation", () => {
  let getSuperAnalytics;

  beforeEach(() => {
    // Stub collections
    mongoose.connection.db = {
      collection: (name) => {
        if (name === "student") {
          return {
            aggregate: () => ({ toArray: async () => [{ _id: "colA", studentCount: 42 }] }),
          };
        }

        if (name === "submission") {
          return {
            aggregate: () =>
              ({
                toArray: async () => [
                  { _id: "colA", totalSubmissions: 10, avgScorePercent: 55, passingSubmissions: 6 },
                ],
              }),
          };
        }

        if (name === "violation") {
          return { aggregate: () => ({ toArray: async () => [{ _id: "colA", totalViolations: 3 }] }) };
        }

        if (name === "college") {
          return { find: () => ({ toArray: async () => [{ id: "colA", name: "Alpha College" }] }) };
        }

        return { aggregate: () => ({ toArray: async () => [] }), find: () => ({ toArray: async () => [] }) };
      },
    };

    // Import controller after stubbing mongoose
    getSuperAnalytics = require("../src/controllers/SuperAdmin/analytics.controller.js").getSuperAnalytics;
  });

  it("returns aggregated per-college metrics", async () => {
    const req = {};
    const res = { json: jest.fn() };

    await new Promise((resolve, reject) => {
      // call the express-style handler
      getSuperAnalytics(req, res, (err) => (err ? reject(err) : resolve()));
      // asyncHandler will call the wrapped function; resolve when done
      // small timeout to allow async actions
      setTimeout(resolve, 20);
    });

    expect(res.json).toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload).toHaveProperty("colleges");
    expect(Array.isArray(payload.colleges)).toBe(true);
    expect(payload.colleges[0]).toMatchObject({
      collegeId: "colA",
      collegeName: "Alpha College",
      studentCount: 42,
      totalSubmissions: 10,
      totalViolations: 3,
    });
    expect(payload.topPerformingColleges[0]).toMatchObject({
      collegeId: "colA",
      collegeName: "Alpha College",
      avgScore: 55,
    });
    expect(Array.isArray(payload.violationStatistics)).toBe(true);
  });

  it("matches ObjectId aggregation keys by value, not object identity", async () => {
    const collegeId = new mongoose.Types.ObjectId();
    const sameCollegeId = new mongoose.Types.ObjectId(collegeId.toHexString());

    mongoose.connection.db = {
      collection: (name) => {
        if (name === "student") {
          return {
            aggregate: () => ({ toArray: async () => [{ _id: collegeId, studentCount: 12 }] }),
          };
        }

        if (name === "submission") {
          return {
            aggregate: () =>
              ({
                toArray: async () => [
                  { _id: sameCollegeId, totalSubmissions: 7, avgScorePercent: 66.666, passingSubmissions: 5 },
                ],
              }),
          };
        }

        if (name === "violation") {
          return { aggregate: () => ({ toArray: async () => [{ _id: new mongoose.Types.ObjectId(collegeId.toHexString()), totalViolations: 4 }] }) };
        }

        if (name === "college") {
          return { find: () => ({ toArray: async () => [{ _id: new mongoose.Types.ObjectId(collegeId.toHexString()), name: "Object College" }] }) };
        }

        return { aggregate: () => ({ toArray: async () => [] }), find: () => ({ toArray: async () => [] }) };
      },
    };

    const res = { json: jest.fn() };
    await new Promise((resolve, reject) => {
      getSuperAnalytics({}, res, (err) => (err ? reject(err) : resolve()));
      setTimeout(resolve, 20);
    });

    const row = res.json.mock.calls[0][0].colleges[0];
    expect(row).toMatchObject({
      collegeId: collegeId.toHexString(),
      collegeName: "Object College",
      studentCount: 12,
      totalSubmissions: 7,
      averageScorePercent: 66.67,
      totalViolations: 4,
    });
  });
});
