import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// Тема оформления: светлая, тёмная, РН (тёмная + жёлтый акцент Роснефти).
// Значение применяется на <html data-theme>, токены цветов живут в index.css.
export type Theme = "light" | "dark" | "rn";

export const THEMES: Theme[] = ["light", "dark", "rn"];
export const THEME_LABELS: Record<Theme, string> = {
  light: "Светлая",
  dark: "Тёмная",
  rn: "РН",
};

const STORAGE_KEY = "idp-theme";

function readTheme(): Theme {
  try {
    const t = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (t && THEMES.includes(t)) return t;
  } catch {
    /* localStorage недоступен — светлая по умолчанию */
  }
  return "light";
}

const ThemeContext = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({
  theme: "light",
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setTheme = (t: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* нет localStorage — тема не переживёт перезагрузку, не критично */
    }
    setThemeState(t);
  };

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
