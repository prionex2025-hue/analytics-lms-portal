const ExcelJS = require("exceljs");

/**
 * XLSX serialisation for report exports.
 *
 * Same column contract as csv-export.service ({ key, label, format? }), so the
 * two formats can never drift apart. Values are written as typed cells —
 * numbers stay numbers (sortable/summable in Excel) and strings are stored as
 * literal strings, which also neutralises formula-injection by construction.
 */

const SHEET_NAME_LIMIT = 31; // hard Excel limit
const MIN_WIDTH = 10;
const MAX_WIDTH = 45;

const cellValue = (column, row) => {
  const raw = column.format ? column.format(row[column.key], row) : row[column.key];
  if (raw == null) return "";
  if (raw instanceof Date) return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  return String(raw);
};

const buildXlsxBuffer = async ({ sheetName = "Report", columns = [], rows = [] }) => {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(String(sheetName).slice(0, SHEET_NAME_LIMIT) || "Report", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = columns.map((column) => ({
    header: String(column.label ?? column.key),
    key: column.key,
    width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, String(column.label ?? column.key).length + 4)),
  }));

  for (const row of rows) {
    sheet.addRow(Object.fromEntries(columns.map((column) => [column.key, cellValue(column, row)])));
  }

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle" };

  return workbook.xlsx.writeBuffer();
};

const buildXlsxFileName = (prefix) => {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `${prefix}-${stamp}.xlsx`;
};

module.exports = {
  buildXlsxBuffer,
  buildXlsxFileName,
};
