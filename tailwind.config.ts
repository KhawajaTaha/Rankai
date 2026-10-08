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
          50: "#eef4fd", 100: "#d9e6fa", 200: "#b6cdf3", 300: "#86aae8", 400: "#5583d8", 500: "#3264c3", 600: "#1f4fae", 700: "#1a418f", 800: "#183775", 900: "#162f60",
        },
        accent: { 400: "#fb923c", 500: "#f47b20", 600: "#e0650d" },
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
