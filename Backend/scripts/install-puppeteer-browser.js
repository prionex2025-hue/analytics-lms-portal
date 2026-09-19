const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const SYSTEM_BROWSER_PATHS = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

const hasSystemBrowser = SYSTEM_BROWSER_PATHS.some((filePath) => fs.existsSync(filePath));

if (hasSystemBrowser) {
  console.log("Puppeteer install: system Chrome/Chromium found; skipping browser download.");
  process.exit(0);
}

if (String(process.env.PUPPETEER_SKIP_DOWNLOAD || "").toLowerCase() === "true") {
  console.warn("Puppeteer install: PUPPETEER_SKIP_DOWNLOAD=true and no system browser was found.");
  process.exit(0);
}

console.log("Puppeteer install: no system browser found; installing Puppeteer's Chrome.");

const result = spawnSync(process.execPath, [require.resolve("puppeteer/lib/cjs/puppeteer/node/cli.js"), "browsers", "install", "chrome"], {
  stdio: "inherit",
});

process.exit(result.status || 0);
