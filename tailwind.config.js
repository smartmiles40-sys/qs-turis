/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      // Cores da marca (26/11): mudam com o tema via variáveis RGB do tokens.css.
      colors: {
        marca: "rgb(var(--marca-rgb) / <alpha-value>)",       // fundo/borda (texto branco por cima)
        "marca-tx": "rgb(var(--marca-tx-rgb) / <alpha-value>)", // texto/link em destaque
      },
      screens: {
        // breakpoint extra p/ celulares pequenos (iPhone SE ~375px)
        xs: "400px",
      },
    },
  },
  plugins: [],
};
