import { useEffect } from "react";
import { DEFAULT_SEO, LOGO_URL, SITE_NAME, TWITTER_HANDLE } from "@/lib/seoMetadata";

const ensureMeta = (selector, attributes) => {
  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement("meta");
    Object.entries(attributes).forEach(([key, value]) => {
      element.setAttribute(key, value);
    });
    document.head.appendChild(element);
  }
  return element;
};

const setMetaContent = (selector, attributes, content) => {
  const element = ensureMeta(selector, attributes);
  element.setAttribute("content", content);
};

const setLinkHref = (selector, attributes, href) => {
  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement("link");
    Object.entries(attributes).forEach(([key, value]) => {
      element.setAttribute(key, value);
    });
    document.head.appendChild(element);
  }
  element.setAttribute("href", href);
};

const setRouteStructuredData = (structuredDataJson) => {
  const selector = 'script[type="application/ld+json"][data-seo="route"]';
  let element = document.head.querySelector(selector);

  if (!structuredDataJson) {
    element?.remove();
    return;
  }

  if (!element) {
    element = document.createElement("script");
    element.setAttribute("type", "application/ld+json");
    element.setAttribute("data-seo", "route");
    document.head.appendChild(element);
  }

  element.textContent = structuredDataJson;
};

export const useSeo = ({
  title = DEFAULT_SEO.title,
  description = DEFAULT_SEO.description,
  keywords = DEFAULT_SEO.keywords,
  canonicalUrl,
  robots = DEFAULT_SEO.robots,
  googlebot = robots,
  ogTitle = title,
  ogDescription = description,
  ogUrl = canonicalUrl,
  imageUrl = LOGO_URL,
  imageAlt = SITE_NAME,
  twitterTitle = ogTitle,
  twitterDescription = ogDescription,
  twitterHandle = TWITTER_HANDLE,
  structuredData = null,
} = {}) => {
  const resolvedCanonicalUrl =
    canonicalUrl || (typeof window !== "undefined" ? window.location.href : DEFAULT_SEO.canonicalUrl);
  const resolvedOgUrl = ogUrl || resolvedCanonicalUrl;
  const structuredDataJson = structuredData ? JSON.stringify(structuredData) : "";

  useEffect(() => {
    document.title = title;

    setMetaContent('meta[name="description"]', { name: "description" }, description);
    setMetaContent('meta[name="keywords"]', { name: "keywords" }, keywords);
    setMetaContent('meta[name="robots"]', { name: "robots" }, robots);
    setMetaContent('meta[name="googlebot"]', { name: "googlebot" }, googlebot);
    setMetaContent('meta[property="og:type"]', { property: "og:type" }, "website");
    setMetaContent('meta[property="og:title"]', { property: "og:title" }, ogTitle);
    setMetaContent('meta[property="og:description"]', { property: "og:description" }, ogDescription);
    setMetaContent('meta[property="og:url"]', { property: "og:url" }, resolvedOgUrl);
    setMetaContent('meta[property="og:image"]', { property: "og:image" }, imageUrl);
    setMetaContent('meta[property="og:image:width"]', { property: "og:image:width" }, "1200");
    setMetaContent('meta[property="og:image:height"]', { property: "og:image:height" }, "630");
    setMetaContent('meta[property="og:image:alt"]', { property: "og:image:alt" }, imageAlt);
    setMetaContent('meta[property="og:site_name"]', { property: "og:site_name" }, SITE_NAME);
    setMetaContent('meta[name="twitter:card"]', { name: "twitter:card" }, "summary_large_image");
    setMetaContent('meta[name="twitter:image"]', { name: "twitter:image" }, imageUrl);
    setMetaContent('meta[name="twitter:site"]', { name: "twitter:site" }, twitterHandle);
    setMetaContent('meta[name="twitter:creator"]', { name: "twitter:creator" }, twitterHandle);
    setMetaContent('meta[name="twitter:title"]', { name: "twitter:title" }, twitterTitle);
    setMetaContent('meta[name="twitter:description"]', { name: "twitter:description" }, twitterDescription);

    setLinkHref('link[rel="canonical"]', { rel: "canonical" }, resolvedCanonicalUrl);
    setRouteStructuredData(structuredDataJson);
  }, [
    description,
    googlebot,
    imageAlt,
    imageUrl,
    keywords,
    ogDescription,
    ogTitle,
    resolvedCanonicalUrl,
    resolvedOgUrl,
    robots,
    structuredDataJson,
    title,
    twitterDescription,
    twitterHandle,
    twitterTitle,
  ]);
};
