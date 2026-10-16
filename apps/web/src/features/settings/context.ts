import { createContext, useContext } from "react";

export type SettingsSection =
  | "appearance"
  | "models"
  | "computers"
  | "devices"
  | "instance";
export const SettingsContext = createContext<{
  open: (section?: SettingsSection, botId?: number) => void;
}>({ open: () => {} });
export const useSettings = () => useContext(SettingsContext);
