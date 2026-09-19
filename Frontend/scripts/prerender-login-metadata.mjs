import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LOGIN_SEO, LOGO_URL, SITE_NAME, TWITTER_HANDLE } from "../src/lib/seoMetadata.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");
const distRoot = path.join(frontendRoot, "dist");
const indexPath = path.join(distRoot, "index.html");

const routes = [
  ["/login", LOGIN_SEO.student],
  ["/admin/login", LOGIN_SEO.admin],
  ["/college-admin/login", LOGIN_SEO.collegeAdmin],
  ["/super-admin/login", LOGIN_SEO.superAdmin],
];

const escapeAttr = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const renderStructuredData = (structuredData) => {
  if (!structuredData) {
    return "";
  }

  const json = JSON.stringify(structuredData, null, 6).replaceAll("<", "\\u003c");
  return `    <script type="application/ld+json" data-seo="route">\n${json
    .split("\n")
    .map((line) => `      ${line}`)
    .join("\n")}\n    </script>\n`;
};

const renderSeoBlock = (seo) => `    <!-- SEO_META_START -->
    <title>${escapeAttr(seo.title)}</title>
    <link rel="canonical" href="${escapeAttr(seo.canonicalUrl)}" />
    <meta name="description" content="${escapeAttr(seo.description)}" />
    <meta name="keywords" content="${escapeAttr(seo.keywords)}" />
    <meta name="robots" content="${escapeAttr(seo.robots)}" />
    <meta name="googlebot" content="${escapeAttr(seo.googlebot || seo.robots)}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeAttr(seo.ogTitle)}" />
    <meta property="og:description" content="${escapeAttr(seo.ogDescription)}" />
    <meta property="og:url" content="${escapeAttr(seo.ogUrl)}" />
    <meta property="og:image" content="${escapeAttr(LOGO_URL)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${escapeAttr(SITE_NAME)}" />
    <meta property="og:site_name" content="${escapeAttr(SITE_NAME)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="${escapeAttr(LOGO_URL)}" />
    <meta name="twitter:site" content="${escapeAttr(TWITTER_HANDLE)}" />
    <meta name="twitter:creator" content="${escapeAttr(TWITTER_HANDLE)}" />
    <meta name="twitter:title" content="${escapeAttr(seo.ogTitle)}" />
    <meta name="twitter:description" content="${escapeAttr(seo.ogDescription)}" />
${renderStructuredData(seo.structuredData)}    <!-- SEO_META_END -->`;

const replaceSeoBlock = (html, seo) =>
  html.replace(
    /    <!-- SEO_META_START -->[\s\S]*?    <!-- SEO_META_END -->/,
    renderSeoBlock(seo),
  );

const sourceHtml = await readFile(indexPath, "utf8");
await writeFile(indexPath, replaceSeoBlock(sourceHtml, LOGIN_SEO.student));

await Promise.all(
  routes.map(async ([route, seo]) => {
    const routeDir = path.join(distRoot, route.replace(/^\//, ""));
    await mkdir(routeDir, { recursive: true });
    await writeFile(path.join(routeDir, "index.html"), replaceSeoBlock(sourceHtml, seo));
  }),
);
