import { Select } from "@domos/ui/controls";
import { useTheme } from "@domos/ui/theme";
import { themePreference } from "@domos/ui/tokens";

export function AppearancePicker() {
  const theme = useTheme();
  return (
    <div className="appearance-picker">
      <Select
        variant="quiet"
        name="appearance"
        aria-label="外观"
        value={theme.preference}
        onChange={(event) => theme.select(themePreference(event.target.value))}
      >
        <option value="system">跟随系统</option>
        <option value="light">浅色</option>
        <option value="dark">深色</option>
      </Select>
      {theme.error && (
        <p className="alert" role="alert">
          外观已应用，但未能保存。
        </p>
      )}
    </div>
  );
}
