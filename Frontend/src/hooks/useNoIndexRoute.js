import { useEffect } from "react";

const ensureMeta = (selector, attributes) => {
  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement("meta");
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    document.head.appendChild(element);
  }
  return element;
};

const setMetaContent = (selector, attributes, content) => {
  ensureMeta(selector, attributes).setAttribute("content", content);
};

const removeRouteStructuredData = () => {
  document.head.querySelector('script[type="application/ld+json"][data-seo="route"]')?.remove();
};

export const useNoIndexRoute = () => {
  useEffect(() => {
    setMetaContent("meta[name=\"robots\"]", { name: "robots" }, "noindex, nofollow, noarchive");
    setMetaContent("meta[name=\"googlebot\"]", { name: "googlebot" }, "noindex, nofollow, noarchive");
    removeRouteStructuredData();
  });
};
