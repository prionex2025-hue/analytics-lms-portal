/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "var(--primary)",
        "primary-dark": "var(--primary-dark)",
        background: "var(--background)",
        card: "var(--card)",
        border: "var(--border)",
        "text-primary": "var(--text-primary)",
        "text-secondary": "var(--text-secondary)",
        success: "var(--success)",
        danger: "var(--danger)",
        warning: "var(--warning)",
        pending: "var(--pending)",
      },
      borderRadius: {
        xl: "0.75rem",
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 23, 42, 0.06)",
      },
    },
  },
};
