const fs = require("node:fs");
const puppeteer = require("puppeteer");

const WINDOWS_BROWSER_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

const LINUX_BROWSER_PATHS = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
];

const resolveExecutablePath = () => {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }

  return [...LINUX_BROWSER_PATHS, ...WINDOWS_BROWSER_PATHS].find((filePath) => fs.existsSync(filePath)) || undefined;
};

const renderHtmlToPdfBuffer = async (html, options = {}) => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: resolveExecutablePath(),
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  } catch (error) {
    // Surface a clear, actionable message instead of a raw spawn error so the
    // report job's errorMessage tells the operator what is actually missing.
    throw new Error(
      `PDF renderer could not start a browser. Ensure Chrome/Chromium is installed or PUPPETEER_EXECUTABLE_PATH is set. (${error.message})`
    );
  }

  try {
    const page = await browser.newPage();
    // The report HTML is fully self-contained (no external fonts, scripts, or
    // images), so we deliberately wait ONLY for the DOM to parse. Waiting for
    // "networkidle0" here used to hang the whole render whenever an outbound
    // request (e.g. a CDN) could not settle on a locked-down server, which
    // surfaced to admins as "error while generating PDF".
    await page.setContent(String(html || ""), {
      waitUntil: "domcontentloaded",
      timeout: options.timeout || 30000,
    });

    await page.emulateMediaType("screen");

    const showHeaderFooter = Boolean(options.displayHeaderFooter || options.headerTemplate || options.footerTemplate);
    const margin = options.margin || {
      top: "12mm",
      right: "10mm",
      bottom: showHeaderFooter ? "16mm" : "12mm",
      left: "10mm",
    };

    const pdfData = await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: showHeaderFooter,
      headerTemplate: options.headerTemplate || "<div></div>",
      footerTemplate: options.footerTemplate || "<div></div>",
      margin,
    });

    // Puppeteer can return Uint8Array in newer versions; normalize to Buffer for Express binary responses.
    return Buffer.isBuffer(pdfData) ? pdfData : Buffer.from(pdfData);
  } finally {
    await browser.close();
  }
};

module.exports = {
  renderHtmlToPdfBuffer,
};
