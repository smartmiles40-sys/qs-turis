/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      screens: {
        // breakpoint extra p/ celulares pequenos (iPhone SE ~375px)
        xs: "400px",
      },
    },
  },
  plugins: [],
};
