/**
 * CSV serialisation for report exports.
 *
 * Zero-dependency and RFC 4180 compliant. Also guards against CSV injection:
 * a value beginning with =, +, -, @, tab or CR is prefixed with a single quote
 * so spreadsheet software treats it as text rather than executing it as a
 * formula when the file is opened.
 */

const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

const escapeCell = (value) => {
  if (value == null) return "";

  let text = value instanceof Date ? value.toISOString() : String(value);

  if (FORMULA_PREFIXES.some((prefix) => text.startsWith(prefix))) {
    text = `'${text}`;
  }

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
};

/**
 * @param columns [{ key, label, format? }]
 * @param rows    array of plain objects
 */
const toCsv = (columns = [], rows = []) => {
  if (!columns.length) return "";

  const header = columns.map((column) => escapeCell(column.label ?? column.key)).join(",");
  const body = rows.map((row) =>
    columns
      .map((column) => {
        const raw = column.format ? column.format(row[column.key], row) : row[column.key];
        return escapeCell(raw);
      })
      .join(",")
  );

  // Leading BOM so Excel opens UTF-8 accented names correctly.
  return `﻿${[header, ...body].join("\r\n")}\r\n`;
};

const buildFileName = (prefix) => {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `${prefix}-${stamp}.csv`;
};

module.exports = {
  toCsv,
  escapeCell,
  buildFileName,
};
