import { useState } from "react";

export default function LazyImage({
  alt,
  className = "",
  fallback = null,
  height,
  src,
  width,
  ...props
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return fallback;
  }

  return (
    <img
      src={src}
      alt={alt || ""}
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      className={className}
      onError={() => setFailed(true)}
      {...props}
    />
  );
}
