import base from "./eslint.config.js";
import { jsxNoUndef } from "./__probe/jsx-no-undef-rule.mjs";

export default [
  ...base,
  {
    files: ["**/*.{js,jsx}"],
    plugins: { probe: { rules: { "jsx-no-undef": jsxNoUndef } } },
    rules: { "probe/jsx-no-undef": "error" },
  },
];
