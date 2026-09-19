import { describe, expect, it, vi, beforeEach } from "vitest";
import { strToU8, zipSync } from "fflate";
import { parseSpreadsheetRows } from "./spreadsheet";

const mocks = vi.hoisted(() => ({
  readXlsxFile: vi.fn(),
}));

vi.mock("read-excel-file/browser", () => ({
  default: mocks.readXlsxFile,
}));

const makeFile = (name = "students.xlsx") => new File([""], name, {
  type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
});

const makeXlsxFile = () => {
  const files = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
        <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
        <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
      </Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
      </Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets><sheet name="Students" sheetId="1" r:id="rId1"/></sheets>
      </workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
      </Relationships>`),
    "xl/sharedStrings.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <si><t>fullName</t></si><si><t>email</t></si><si><t>enrollNumber</t></si>
        <si><t>department</t></si><si><t>year</t></si><si><t>Alice Sharma</t></si>
        <si><t>alice.sharma@example.com</t></si><si><t>Computer Science</t></si>
      </sst>`),
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <sheetData>
          <row r="1">
            <c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c>
            <c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c>
          </row>
          <row r="2">
            <c r="A2" t="s"><v>5</v></c><c r="B2" t="s"><v>6</v></c><c r="C2"><f>20000000+1</f><v>20000001</v></c>
            <c r="D2" t="s"><v>7</v></c><c r="E2"><v>1</v></c>
          </row>
        </sheetData>
      </worksheet>`),
  };

  return new File([zipSync(files)], "students.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
};

describe("parseSpreadsheetRows", () => {
  beforeEach(() => {
    mocks.readXlsxFile.mockReset();
  });

  it("reads rows from read-excel-file v9 sheet results", async () => {
    mocks.readXlsxFile.mockResolvedValue([
      {
        sheet: "Students",
        data: [
          ["fullName", "email", "enrollNumber", "department", "year", "batch"],
          ["Alice Doe", "alice@example.com", 20261001, "Computer Science", 1, "CSE-2027-A"],
        ],
      },
    ]);

    await expect(parseSpreadsheetRows(makeFile())).resolves.toEqual([
      {
        fullName: "Alice Doe",
        email: "alice@example.com",
        enrollNumber: "20261001",
        department: "Computer Science",
        year: "1",
        batch: "CSE-2027-A",
      },
    ]);
  });

  it("skips blank, instruction, and empty sheets before finding headers", async () => {
    mocks.readXlsxFile.mockResolvedValue([
      { sheet: "Instructions", data: [["Use the next tab for import"]] },
      {
        sheet: "Students",
        data: [
          [null, null, null],
          ["Student import template"],
          ["Full Name", "Email", "Enrollment Number", "Department Name", "Academic Year"],
          ["Alice Doe", "alice@example.com", "20261001", "Computer Science", "1"],
        ],
      },
    ]);

    await expect(parseSpreadsheetRows(makeFile())).resolves.toEqual([
      {
        "Full Name": "Alice Doe",
        Email: "alice@example.com",
        "Enrollment Number": "20261001",
        "Department Name": "Computer Science",
        "Academic Year": "1",
      },
    ]);
  });

  it("keeps compatibility with older row-array results", async () => {
    mocks.readXlsxFile.mockResolvedValue([
      ["fullName", "email"],
      ["Alice Doe", "alice@example.com"],
    ]);

    await expect(parseSpreadsheetRows(makeFile())).resolves.toEqual([
      {
        fullName: "Alice Doe",
        email: "alice@example.com",
      },
    ]);
  });

  it("falls back to workbook XML when the primary reader returns no rows", async () => {
    mocks.readXlsxFile.mockResolvedValue([{ sheet: "Students", data: [] }]);

    await expect(parseSpreadsheetRows(makeXlsxFile())).resolves.toEqual([
      {
        fullName: "Alice Sharma",
        email: "alice.sharma@example.com",
        enrollNumber: "20000001",
        department: "Computer Science",
        year: "1",
      },
    ]);
  });
});
