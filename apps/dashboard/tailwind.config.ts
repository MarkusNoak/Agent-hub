import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#f7f7f8",
          100: "#ebecee",
          200: "#d6d8dc",
          500: "#6b6f78",
          700: "#3a3d45",
          900: "#111318",
        },
        brand: {
          DEFAULT: "#0b5cff",
          soft: "#dbe8ff",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
