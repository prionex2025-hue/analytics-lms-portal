import DOMPurify from "dompurify";

const allowedTags = ["b", "strong", "i", "em", "u", "a", "p", "br", "ul", "ol", "li"];
const allowedAttributes = ["href", "target", "rel"];

export const sanitizeHtml = (raw) =>
  DOMPurify.sanitize(String(raw || ""), {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: allowedAttributes,
  });

export const sanitizeText = (raw) =>
  DOMPurify.sanitize(String(raw || ""), {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
  });
