import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  resolveTheme,
  type ThemePreference,
  themePreference,
  themeStyles,
  themes,
} from "../tokens.ts";

const storageKey = "domos:appearance:v1";
const mediaQuery = "(prefers-color-scheme: dark)";
const ThemeContext = createContext<{
  preference: ThemePreference;
  select: (preference: ThemePreference) => void;
  error: boolean;
} | null>(null);

function apply(preference: ThemePreference) {
  const theme = resolveTheme(
    preference,
    matchMedia(mediaQuery).matches ? "dark" : "light",
  );
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", themes[theme].frame);
}

export function initializeTheme(): ThemePreference {
  if (!document.getElementById("domos-theme")) {
    const style = document.createElement("style");
    style.id = "domos-theme";
    style.textContent = themeStyles;
    document.head.append(style);
  }
  let preference: ThemePreference = "system";
  try {
    preference = themePreference(localStorage.getItem(storageKey));
  } catch {}
  apply(preference);
  return preference;
}

export function ThemeProvider({
  initialPreference,
  children,
}: {
  initialPreference: ThemePreference;
  children: ReactNode;
}) {
  const [preference, setPreference] = useState(initialPreference);
  const [error, setError] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const pointer = () => {
      root.dataset.navigation = "pointer";
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Tab") root.dataset.navigation = "keyboard";
    };
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", keyboard, true);
    return () => {
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", keyboard, true);
      delete root.dataset.navigation;
    };
  }, []);
  useEffect(() => {
    const media = matchMedia(mediaQuery);
    const update = () => apply(preference);
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) {
        const next = themePreference(event.newValue);
        apply(next);
        setPreference(next);
        setError(false);
      }
    };
    media.addEventListener("change", update);
    window.addEventListener("storage", sync);
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("storage", sync);
    };
  }, [preference]);
  function select(next: ThemePreference) {
    apply(next);
    setPreference(next);
    try {
      localStorage.setItem(storageKey, next);
      setError(false);
    } catch {
      setError(true);
    }
  }
  return (
    <ThemeContext value={{ preference, select, error }}>
      {children}
    </ThemeContext>
  );
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("ThemeProvider required");
  return value;
}
