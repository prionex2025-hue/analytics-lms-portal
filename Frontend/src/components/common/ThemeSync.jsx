import { useEffect } from "react";
import { useSelector } from "react-redux";

const applyThemeToRoot = (theme) => {
  const root = document.documentElement;

  if (theme === "dark") {
    root.classList.add("dark");
    root.dataset.theme = "dark";
    return;
  }

  if (theme === "light") {
    root.classList.remove("dark");
    root.dataset.theme = "light";
    return;
  }

  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  root.classList.toggle("dark", prefersDark);
  root.dataset.theme = "system";
};

export default function ThemeSync() {
  const selectedTheme = useSelector((state) => state.ui?.theme || "system");

  useEffect(() => {
    applyThemeToRoot(selectedTheme);

    if (selectedTheme !== "system") {
      return undefined;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => applyThemeToRoot("system");

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", handleChange);
      return () => media.removeEventListener("change", handleChange);
    }

    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, [selectedTheme]);

  return null;
}
