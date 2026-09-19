const ExcelJS = require("exceljs");
const { buildXlsxBuffer, buildXlsxFileName } = require("../../services/xlsx-export.service");

const columns = [
  { key: "name", label: "Student" },
  { key: "score", label: "Score %" },
  { key: "flags", label: "Flags", format: (value) => (value || []).join("; ") },
];

const rows = [
  { name: "Asha", score: 82.5, flags: [] },
  { name: "Kumar, R", score: 39, flags: ["FAILING_AVERAGE", "DECLINING"] },
];

const readBack = async (buffer) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook.worksheets[0];
};

describe("xlsx export", () => {
  it("writes a header row and data rows that round-trip through Excel", async () => {
    const sheet = await readBack(await buildXlsxBuffer({ sheetName: "at-risk-students", columns, rows }));

    expect(sheet.getRow(1).values.slice(1)).toEqual(["Student", "Score %", "Flags"]);
    expect(sheet.getRow(2).getCell(1).value).toBe("Asha");
    expect(sheet.getRow(3).getCell(1).value).toBe("Kumar, R");
    expect(sheet.getRow(3).getCell(3).value).toBe("FAILING_AVERAGE; DECLINING");
  });

  it("keeps numbers as numbers so Excel can sort and sum them", async () => {
    const sheet = await readBack(await buildXlsxBuffer({ sheetName: "s", columns, rows }));
    expect(sheet.getRow(2).getCell(2).value).toBe(82.5);
    expect(typeof sheet.getRow(2).getCell(2).value).toBe("number");
  });

  it("stores formula-looking strings as literal text, not formulas", async () => {
    const sheet = await readBack(
      await buildXlsxBuffer({
        sheetName: "s",
        columns: [{ key: "name", label: "Name" }],
        rows: [{ name: "=cmd|'/c calc'!A1" }],
      })
    );
    const cell = sheet.getRow(2).getCell(1);
    expect(cell.value).toBe("=cmd|'/c calc'!A1");
    expect(cell.formula).toBeUndefined();
  });

  it("clamps the sheet name to the 31-character Excel limit", async () => {
    const sheet = await readBack(
      await buildXlsxBuffer({ sheetName: "x".repeat(60), columns, rows: [] })
    );
    expect(sheet.name).toHaveLength(31);
  });

  it("builds a timestamped .xlsx filename", () => {
    expect(buildXlsxFileName("test-performance")).toMatch(/^test-performance-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.xlsx$/);
  });
});
