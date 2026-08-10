import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// Color theme: light, dark, RN (dark + Rosneft's yellow accent).
// The value is applied on <html data-theme>, color tokens live in index.css.
export type Theme = "light" | "dark" | "rn";

// What the user picked. "system" is not a look of its own - it is the choice to
// let the operating system decide, and it resolves to light or dark. Everything
// that paints reads the resolved theme; only the switcher reads the choice, so
// that picking "system" keeps showing as "system" whatever the system says.
export type ThemeChoice = Theme | "system";

export const THEME_CHOICES: ThemeChoice[] = ["system", "light", "dark", "rn"];
export const THEME_LABELS: Record<ThemeChoice, string> = {
  system: "Как в системе",
  light: "Светлая",
  dark: "Тёмная",
  rn: "РН",
};

const STORAGE_KEY = "idp-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

// A first visit follows the system: the person has already answered the light
// or dark question in their operating system, and asking again by starting on
// the wrong one is the worse guess. A stored choice always wins, so nobody who
// has picked a theme is moved off it.
function readChoice(): ThemeChoice {
  try {
    const t = localStorage.getItem(STORAGE_KEY) as ThemeChoice | null;
    if (t && THEME_CHOICES.includes(t)) return t;
  } catch {
    /* localStorage unavailable - follow the system */
  }
  return "system";
}

function systemTheme(): Theme {
  return window.matchMedia?.(DARK_QUERY).matches ? "dark" : "light";
}

const ThemeContext = createContext<{
  // The theme in force - what everything paints against.
  theme: Theme;
  // What the user picked, which may be "system".
  choice: ThemeChoice;
  // What the system says right now, whether or not it is being followed. The
  // switcher shows it so "как в системе" is not a blind choice.
  system: Theme;
  setTheme: (c: ThemeChoice) => void;
}>({
  theme: "light",
  choice: "system",
  system: "light",
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<ThemeChoice>(readChoice);
  const [system, setSystem] = useState<Theme>(systemTheme);

  // The system is followed live: someone whose desktop turns dark in the
  // evening expects the portal to turn with it, without a reload. The listener
  // runs whatever the choice is - it costs nothing, and its value is only read
  // when the choice is to follow it, which also keeps the switcher able to say
  // what the system is right now.
  useEffect(() => {
    const mq = window.matchMedia?.(DARK_QUERY);
    if (!mq) return;
    const sync = () => setSystem(mq.matches ? "dark" : "light");
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const theme = choice === "system" ? system : choice;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setTheme = (c: ThemeChoice) => {
    try {
      localStorage.setItem(STORAGE_KEY, c);
    } catch {
      /* no localStorage - theme won't survive a reload, not critical */
    }
    setChoice(c);
  };

  return (
    <ThemeContext.Provider value={{ theme, choice, system, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
