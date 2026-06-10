import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          50:  "#f7f3ee",
          100: "#ede7dc",
          200: "#d9cfc2",
          300: "#c4b5a4",
          400: "#a09080",
          500: "#7a6f62",
          600: "#5c5348",
          700: "#3d3529",
          800: "#2a251c",
          900: "#1a1410",
        },
        brand: {
          DEFAULT: "#e8a020",
          hover:   "#d08e10",
          soft:    "#fdf3de",
          muted:   "#fef9ee",
        },
        surface: {
          DEFAULT: "#ffffff",
          muted:   "#f7f3ee",
          dark:    "#1a1410",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        "card":    "0 1px 3px 0 rgb(0 0 0 / 0.04), 0 4px 16px -4px rgb(0 0 0 / 0.06)",
        "card-lg": "0 2px 8px 0 rgb(0 0 0 / 0.06), 0 16px 40px -8px rgb(0 0 0 / 0.10)",
        "card-hover": "0 4px 12px 0 rgb(0 0 0 / 0.08), 0 20px 48px -8px rgb(0 0 0 / 0.12)",
        "glow-brand": "0 0 0 3px rgb(232 160 32 / 0.15)",
      },
      backgroundImage: {
        "gradient-brand": "linear-gradient(135deg, #e8a020 0%, #f0b840 100%)",
        "gradient-dark":  "linear-gradient(135deg, #1a1410 0%, #2a251c 100%)",
        "gradient-green": "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)",
        "gradient-amber": "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)",
        "gradient-blue":  "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
        "gradient-purple":"linear-gradient(135deg, #faf5ff 0%, #ede9fe 100%)",
        "gradient-rose":  "linear-gradient(135deg, #fff1f2 0%, #ffe4e6 100%)",
      },
    },
  },
  plugins: [],
} satisfies Config;
