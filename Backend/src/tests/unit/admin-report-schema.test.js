const { reportAnalyticsQuerySchema } = require("../../schemas/Admin/admin-core.schema");

describe("admin report analytics schema", () => {
  it("preserves valid date filters for analytics queries", () => {
    const parsed = reportAnalyticsQuerySchema.parse({
      body: {},
      params: {},
      query: {
        mode: "student",
        dateFrom: "2026-01-01T00:00:00.000Z",
        dateTo: "2026-01-31T23:59:59.000Z",
      },
    });

    expect(parsed.query.dateFrom).toBe("2026-01-01T00:00:00.000Z");
    expect(parsed.query.dateTo).toBe("2026-01-31T23:59:59.000Z");
  });

  it("rejects inverted date ranges", () => {
    expect(() =>
      reportAnalyticsQuerySchema.parse({
        body: {},
        params: {},
        query: {
          mode: "student",
          dateFrom: "2026-02-01T00:00:00.000Z",
          dateTo: "2026-01-01T00:00:00.000Z",
        },
      })
    ).toThrow();
  });
});
