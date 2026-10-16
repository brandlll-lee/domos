import { createContext, type ReactNode, useContext } from "react";
import type { SettingsSection } from "./sections.tsx";

export const SettingsContext = createContext<{
  open: (section?: SettingsSection, botId?: number) => void;
  page: ReactNode;
} | null>(null);

export function useSettings() {
  const value = useContext(SettingsContext);
  if (!value) throw new Error("SettingsRoot required");
  return value;
}
