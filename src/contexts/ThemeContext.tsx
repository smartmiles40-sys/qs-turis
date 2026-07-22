// src/contexts/ThemeContext.tsx
// -----------------------------------------------------------------------------
// Tema claro / escuro (Modo Noturno) — global, persistido por dispositivo.
//
// A escolha vive em localStorage ("qs_theme"); na 1ª visita segue a preferência
// do sistema (prefers-color-scheme). O tema é aplicado como classe no <html>
// (`html.dark`), então TODO o CSS reage por um único seletor:
//   • as variáveis da paleta "Turis" (index.css) trocam de valor → a tela de
//     Execução escurece inteira sem tocar em componente;
//   • a camada global de override (index.css) escurece os utilitários Tailwind
//     mais usados (bg-white, text-gray-*, border-gray-* …).
//
// Anti-flash: index.html já aplica a classe ANTES do React montar (script inline),
// então não há "piscada" branca ao carregar no escuro. Este provider só mantém o
// estado em sincronia e persiste a troca.
// -----------------------------------------------------------------------------

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

export type Theme = "light" | "dark";
export const THEME_KEY = "qs_theme";

/** Lê o tema efetivo já aplicado no <html> (definido pelo script anti-flash). */
function readInitialTheme(): Theme {
  if (typeof document !== "undefined" && document.documentElement.classList.contains("dark")) {
    return "dark";
  }
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") return saved;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
  } catch { /* localStorage pode falhar em modo restrito */ }
  return "light";
}

/** Aplica a classe no <html> e ajusta o color-scheme nativo (scrollbars/inputs). */
function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

interface ThemeContextType {
  theme: Theme;
  isDark: boolean;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "light",
  isDark: false,
  toggleTheme: () => {},
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    applyTheme(t);
    try { localStorage.setItem(THEME_KEY, t); } catch { /* ignora */ }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  // Garante consistência caso o estado inicial e o <html> divirjam (StrictMode).
  useEffect(() => { applyTheme(theme); }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, isDark: theme === "dark", toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
