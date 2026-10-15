import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  compactChat,
  metrics,
  resolveTheme,
  type ThemePreference,
  themePreference,
  themes,
} from "../tokens.ts";

const storageKey = "domos:appearance:v1";
const mediaQuery = "(prefers-color-scheme: dark)";
const variables = (values: Record<string, string>, prefix = "") =>
  Object.entries(values)
    .map(([key, value]) => `--${prefix}${key}:${value}`)
    .join(";");
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
    ?.setAttribute("content", themes[theme].background);
}

export function initializeTheme(): ThemePreference {
  const style = document.createElement("style");
  style.textContent = `:root{${variables(metrics)}}${Object.entries(themes)
    .map(
      ([name, palette]) =>
        `[data-theme="${name}"]{color-scheme:${name};${variables(palette, "color-")}}`,
    )
    .join(
      "",
    )}@container chat (width < ${compactChat.maxWidth}){.chat-surface > *{${variables(compactChat.metrics)}}}`;
  document.head.append(style);
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
