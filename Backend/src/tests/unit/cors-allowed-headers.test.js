const { CORS_ALLOWED_HEADERS } = require("../../config/cors");

describe("CORS allowed headers for the exam flow", () => {
  const lower = CORS_ALLOWED_HEADERS.map((header) => header.toLowerCase());

  it("includes x-test-client-id (sent by start/answer/heartbeat/submit/module-advance)", () => {
    expect(lower).toContain("x-test-client-id");
  });

  it("still includes the baseline auth/content headers", () => {
    expect(lower).toContain("authorization");
    expect(lower).toContain("content-type");
  });
});
