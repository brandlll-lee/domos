import { ChoicePicker } from "@domos/ui/picker";
import { useTheme } from "@domos/ui/theme";
import { themePreference } from "@domos/ui/tokens";

export function AppearancePicker() {
  const theme = useTheme();
  return (
    <div className="appearance-picker">
      <ChoicePicker
        label="外观"
        size="small"
        value={theme.preference}
        onValueChange={(value) => theme.select(themePreference(value))}
        items={[
          { value: "system", label: "跟随系统" },
          { value: "light", label: "浅色" },
          { value: "dark", label: "深色" },
        ]}
      />
      {theme.error && (
        <p className="alert" role="alert">
          外观已应用，但未能保存。
        </p>
      )}
    </div>
  );
}
