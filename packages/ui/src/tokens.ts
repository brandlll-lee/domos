export const themes = {
  dark: {
    background: "#0d0e10",
    sidebar: "#111214",
    surface: "#191a1d",
    hover: "#232427",
    selection: "#202124",
    text: "#ececee",
    muted: "#a0a1a6",
    border: "#292a2e",
    primary: "#ececea",
    "primary-hover": "#d6d6d2",
    "on-primary": "#171819",
    focus: "#a0a1a6",
    link: "#a3c7ff",
    danger: "#ffb4ab",
    "danger-surface": "#342321",
    user: "#242528",
    "on-user": "#ececee",
  },
  light: {
    background: "#fafaf8",
    sidebar: "#f0f0ed",
    surface: "#ffffff",
    hover: "#e8e8e4",
    selection: "#e4e4df",
    text: "#202123",
    muted: "#62636a",
    border: "#d8d8d2",
    primary: "#242527",
    "primary-hover": "#404145",
    "on-primary": "#fafaf8",
    focus: "#62636a",
    link: "#235db0",
    danger: "#a92520",
    "danger-surface": "#fcecea",
    user: "#eaeae5",
    "on-user": "#202123",
  },
} as const;

export type Theme = keyof typeof themes;
export type ThemePreference = Theme | "system";

export function themePreference(value: string | null): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(
  preference: ThemePreference,
  system: Theme,
): Theme {
  return preference === "system" ? system : preference;
}

export const metrics = {
  "font-body": '"Geist Variable", "Segoe UI", "Microsoft YaHei", sans-serif',
  "text-small": "0.75rem",
  "text-label": "0.875rem",
  "text-body": "0.9375rem",
  "text-display": "1.75rem",
  "space-1": "0.25rem",
  "space-2": "0.5rem",
  "space-3": "0.75rem",
  "space-4": "1rem",
  "space-5": "1.25rem",
  "space-6": "1.5rem",
  "space-8": "2rem",
  "space-10": "2.5rem",
  "space-12": "3rem",
  "radius-control": "0.5rem",
  "radius-message": "1.125rem",
  "radius-composer": "1.75rem",
  "radius-round": "999px",
  "content-width": "46rem",
  "sidebar-width": "15.5rem",
  "control-height": "2.75rem",
  "composer-max-height": "10rem",
  "motion-feedback": "140ms",
} as const;
