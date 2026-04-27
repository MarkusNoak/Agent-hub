import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Warm neutrals — weknowit.se background palette
        ink: {
          50:  "#f7f3ee",
          100: "#ede7dc",
          200: "#d9cfc2",
          500: "#7a6f62",
          700: "#3d3529",
          900: "#1a1410",
        },
        // Amber/gold — the CTA colour on weknowit.se
        brand: {
          DEFAULT: "#e8a020",
          hover:   "#d08e10",
          soft:    "#fdf3de",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
