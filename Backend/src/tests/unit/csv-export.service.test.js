const { toCsv, escapeCell, buildFileName } = require("../../services/csv-export.service");

describe("csv export", () => {
  const columns = [
    { key: "name", label: "Student" },
    { key: "score", label: "Score" },
  ];

  it("writes a header row and CRLF-terminated records", () => {
    const csv = toCsv(columns, [{ name: "Asha", score: 82 }]);
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toBe("Student,Score");
    expect(lines[1]).toBe("Asha,82");
  });

  it("prefixes a UTF-8 BOM so Excel renders accented names", () => {
    expect(toCsv(columns, [{ name: "José", score: 1 }]).startsWith("﻿")).toBe(true);
  });

  it("quotes values containing commas, quotes or newlines", () => {
    expect(escapeCell("Kumar, R")).toBe('"Kumar, R"');
    expect(escapeCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(escapeCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("neutralises CSV injection payloads", () => {
    // A cell starting with = would otherwise execute as a formula in Excel.
    expect(escapeCell("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1");
    expect(escapeCell("+1234")).toBe("'+1234");
    expect(escapeCell("@SUM(A1)")).toBe("'@SUM(A1)");
    // A leading minus is also a formula lead-in.
    expect(escapeCell("-5")).toBe("'-5");
  });

  it("renders null and undefined as empty cells", () => {
    const csv = toCsv(columns, [{ name: null, score: undefined }]);
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    expect(lines[1]).toBe(",");
  });

  it("applies a column formatter when provided", () => {
    const csv = toCsv([{ key: "score", label: "Score", format: (value) => `${value}%` }], [{ score: 91 }]);
    expect(csv).toContain("91%");
  });

  it("builds a timestamped filename", () => {
    expect(buildFileName("student-report")).toMatch(/^student-report-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.csv$/);
  });

  it("returns an empty string when there are no columns", () => {
    expect(toCsv([], [{ a: 1 }])).toBe("");
  });
});
