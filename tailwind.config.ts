import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      colors: {
        brand: {
          50: "#eef4ff", 100: "#dae6ff", 200: "#bcd3ff", 300: "#8eb6ff", 400: "#598cff",
          500: "#3b6bff", 600: "#1f48f5", 700: "#1836e1", 800: "#1a2fb6", 900: "#1b2e8f",
        },
        ink: { 50: "#f7f8fa", 100: "#eef0f4", 200: "#dde1e8", 300: "#c2c8d3", 400: "#8f98a8", 500: "#677084", 600: "#4b5366", 700: "#363c4c", 800: "#232733", 900: "#151821" },
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)",
        pop: "0 10px 30px -10px rgba(16,24,40,.25)",
      },
      borderRadius: { xl: "0.875rem", "2xl": "1.125rem" },
    },
  },
  plugins: [],
} satisfies Config;
