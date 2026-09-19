const normalizeHeader = (value) => String(value ?? "").replace(/^\uFEFF/, "").trim();

const normalizeCell = (value) => {
  if (value === null || typeof value === "undefined") {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value).trim();
};

const isRowEmpty = (cells = []) => cells.every((value) => normalizeCell(value) === "");

const getXmlNodes = (node, localName) => {
  const namespaced = Array.from(node.getElementsByTagNameNS?.("*", localName) || []);
  return namespaced.length > 0 ? namespaced : Array.from(node.getElementsByTagName(localName));
};

const parseXml = (xmlText) => new DOMParser().parseFromString(xmlText, "application/xml");

const normalizeZipPath = (value) => {
  const parts = String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/");
  const resolved = [];

  parts.forEach((part) => {
    if (!part || part === ".") return;
    if (part === "..") {
      resolved.pop();
      return;
    }
    resolved.push(part);
  });

  return resolved.join("/");
};

const resolveZipTarget = (basePath, target) => {
  if (String(target || "").startsWith("/")) {
    return normalizeZipPath(target);
  }
  return normalizeZipPath(`${basePath}/${target}`);
};

const columnIndexFromRef = (cellRef, fallbackIndex) => {
  const letters = String(cellRef || "").match(/^[A-Z]+/i)?.[0];
  if (!letters) {
    return fallbackIndex;
  }

  return letters
    .toUpperCase()
    .split("")
    .reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
};

const readZipText = (entries, path, decoder) => {
  const bytes = entries[normalizeZipPath(path)];
  return bytes ? decoder.decode(bytes) : "";
};

const readSharedStrings = (entries, decoder) => {
  const xmlText = readZipText(entries, "xl/sharedStrings.xml", decoder);
  if (!xmlText) {
    return [];
  }

  const doc = parseXml(xmlText);
  return getXmlNodes(doc, "si").map((item) => getXmlNodes(item, "t").map((node) => node.textContent || "").join(""));
};

const getCellText = (cell, sharedStrings) => {
  const type = cell.getAttribute("t");
  const valueText = getXmlNodes(cell, "v")[0]?.textContent ?? "";

  if (type === "inlineStr") {
    return getXmlNodes(cell, "t").map((node) => node.textContent || "").join("");
  }

  if (type === "s") {
    return sharedStrings[Number(valueText)] ?? "";
  }

  if (type === "b") {
    return valueText === "1" ? "TRUE" : valueText === "0" ? "FALSE" : valueText;
  }

  return valueText;
};

const readSheetXmlRows = (xmlText, sharedStrings) => {
  if (!xmlText) {
    return [];
  }

  const doc = parseXml(xmlText);
  return getXmlNodes(doc, "row").map((rowNode) => {
    const row = [];
    getXmlNodes(rowNode, "c").forEach((cell, fallbackIndex) => {
      const colIndex = columnIndexFromRef(cell.getAttribute("r"), fallbackIndex);
      row[colIndex] = getCellText(cell, sharedStrings);
    });
    return row;
  });
};

const readXmlWorkbookSheets = async (file) => {
  const { unzipSync } = await import("fflate");
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const decoder = new TextDecoder("utf-8");
  const workbookXml = readZipText(entries, "xl/workbook.xml", decoder);
  const workbookRelsXml = readZipText(entries, "xl/_rels/workbook.xml.rels", decoder);

  if (!workbookXml || !workbookRelsXml) {
    return [];
  }

  const workbookDoc = parseXml(workbookXml);
  const relsDoc = parseXml(workbookRelsXml);
  const rels = new Map(
    getXmlNodes(relsDoc, "Relationship")
      .map((rel) => [rel.getAttribute("Id"), rel.getAttribute("Target")])
      .filter(([id, target]) => id && target)
  );
  const sharedStrings = readSharedStrings(entries, decoder);

  const sheets = getXmlNodes(workbookDoc, "sheet").map((sheetNode) => {
    const relId = sheetNode.getAttribute("r:id") || sheetNode.getAttributeNS?.("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const target = rels.get(relId);
    const sheetPath = target ? resolveZipTarget("xl", target) : "";
    return {
      name: sheetNode.getAttribute("name") || "Sheet",
      rows: readSheetXmlRows(readZipText(entries, sheetPath, decoder), sharedStrings),
    };
  });

  if (sheets.length > 0) {
    return sheets;
  }

  return Object.keys(entries)
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
    .sort()
    .map((path, index) => ({
      name: `Sheet ${index + 1}`,
      rows: readSheetXmlRows(readZipText(entries, path, decoder), sharedStrings),
    }));
};

const toSheetData = (readResult) => {
  if (!Array.isArray(readResult)) {
    return [];
  }

  // read-excel-file v9 default export returns all sheets:
  // [{ sheet: "Sheet1", data: [...] }, ...].
  if (readResult.some((item) => item && typeof item === "object" && Array.isArray(item.data))) {
    return readResult
      .filter((item) => Array.isArray(item.data))
      .map((item) => ({ name: item.sheet || "Sheet", rows: item.data }));
  }

  // Keep compatibility with older versions or readSheet(), which return rows directly.
  return [{ name: "Sheet", rows: readResult }];
};

const getHeaderRowIndex = (rows) => {
  const firstNonEmpty = rows.findIndex((cells) => Array.isArray(cells) && !isRowEmpty(cells));
  if (firstNonEmpty === -1) {
    return -1;
  }

  const firstMultiColumnHeader = rows.findIndex((cells, index) => {
    if (index < firstNonEmpty || !Array.isArray(cells) || isRowEmpty(cells)) {
      return false;
    }

    const nonEmptyHeaders = cells.map(normalizeHeader).filter(Boolean);
    if (nonEmptyHeaders.length < 2) {
      return false;
    }

    return rows.slice(index + 1).some((row) => Array.isArray(row) && !isRowEmpty(row));
  });

  return firstMultiColumnHeader >= 0 ? firstMultiColumnHeader : firstNonEmpty;
};

const getRowsFromSheets = (sheets) => {
  let sawHeader = false;
  let sawDataRows = false;

  for (const sheet of sheets) {
    const rawRows = Array.isArray(sheet.rows) ? sheet.rows : [];
    const headerIndex = getHeaderRowIndex(rawRows);
    if (headerIndex === -1) {
      continue;
    }

    const headers = (Array.isArray(rawRows[headerIndex]) ? rawRows[headerIndex] : []).map(normalizeHeader);
    if (headers.length === 0 || headers.every((header) => !header)) {
      continue;
    }

    sawHeader = true;
    const rows = rawRows
      .slice(headerIndex + 1)
      .filter((cells) => Array.isArray(cells) && !isRowEmpty(cells))
      .map((cells) => {
        const row = {};
        headers.forEach((header, index) => {
          if (!header) return;
          row[header] = normalizeCell(cells[index]);
        });
        return row;
      });

    if (rows.length > 0) {
      return { rows };
    }

    sawDataRows = true;
  }

  if (!sawHeader) {
    return { error: "Selected spreadsheet is missing header columns" };
  }

  if (!sawDataRows) {
    return { error: "Selected spreadsheet has no data rows" };
  }

  return { error: "Selected spreadsheet has no rows" };
};

export const parseSpreadsheetRows = async (file) => {
  if (!file) {
    throw new Error("No file selected");
  }

  const fileName = String(file.name || "").toLowerCase();
  if (fileName.endsWith(".xls")) {
    throw new Error("Legacy .xls files are not supported. Please upload .xlsx or .csv.");
  }

  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const sheets = toSheetData(await readXlsxFile(file));
  const primaryResult = getRowsFromSheets(sheets);
  if (primaryResult.rows) {
    return primaryResult.rows;
  }

  try {
    const xmlResult = getRowsFromSheets(await readXmlWorkbookSheets(file));
    if (xmlResult.rows) {
      return xmlResult.rows;
    }

    throw new Error(xmlResult.error || primaryResult.error || "Selected spreadsheet has no data rows");
  } catch (error) {
    if (error?.message && !/Selected spreadsheet/.test(error.message)) {
      throw new Error(`${primaryResult.error || "Selected spreadsheet has no data rows"}. Save the file as a standard .xlsx workbook and make sure the cells contain typed values.`);
    }
    throw error;
  }
};
