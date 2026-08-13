/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Sunrise over the lake. Marigold is the resting state,
        // ember is effort and intensity. Splits ramp between them.
        marigold: {
          50: "#FEF7EA",
          100: "#FCE9C4",
          200: "#F9D48A",
          300: "#F7BF57",
          400: "#F5A524",
          500: "#E8920F",
          600: "#C4780C",
          700: "#9A5E0A",
          800: "#6E4307",
          900: "#422804",
        },
        ember: {
          50: "#FDEDEA",
          100: "#FAD2CA",
          200: "#F5A996",
          300: "#F07A5F",
          400: "#E8452C",
          500: "#D13519",
          600: "#AF2B14",
          700: "#8A2210",
          800: "#61180B",
          900: "#3B0E07",
        },
        // Near-black with a plum undertone. Warmer than a neutral
        // grey, which keeps it from feeling clinical next to the
        // warm accents.
        ink: {
          DEFAULT: "#1C1523",
          soft: "#2E2438",
        },
        fog: {
          DEFAULT: "#78727F",
          light: "#A9A4AF",
        },
        cloud: {
          DEFAULT: "#F4F2F5",
          dark: "#E6E3E8",
        },
      },
      fontFamily: {
        // Archivo Expanded is wide and slightly athletic — it reads
        // like a scoreboard, which is right when the numbers are the
        // hero of every screen.
        display: ["ArchivoExpanded_600SemiBold"],
        "display-medium": ["ArchivoExpanded_500Medium"],
        sans: ["Inter_400Regular"],
        "sans-medium": ["Inter_500Medium"],
        "sans-semibold": ["Inter_600SemiBold"],
      },
    },
  },
  plugins: [],
};