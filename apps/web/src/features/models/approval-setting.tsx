import {
  type ApprovalMode,
  approvalLabels,
  supportedApprovalModes,
} from "@domos/agent/harness/types";
import { InlineNotice } from "@domos/ui/message";
import { ChoicePicker } from "@domos/ui/picker";
import { SettingRow } from "@domos/ui/setting-row";
import { useModelSettings } from "./model-state.ts";

export function ApprovalSetting({
  botId,
  disabled,
}: {
  botId: number;
  disabled: boolean;
}) {
  const { store, profile, selected, saving } = useModelSettings(botId);
  const config = selected ?? profile?.config;
  const modes =
    profile?.approvalModes ?? supportedApprovalModes(config?.provider ?? "pi");
  const automatic = profile?.automaticApproval && !config?.approvalMode;
  const notice = profile?.runtime?.notices?.permissions;
  return (
    <SettingRow
      title="操作审批"
      notice={
        automatic || notice ? (
          <>
            {automatic && (
              <InlineNotice>
                已保留旧版自动批准。选择权限模式后，将使用新设置。
              </InlineNotice>
            )}
            {notice && <InlineNotice>{notice}</InlineNotice>}
          </>
        ) : undefined
      }
    >
      <ChoicePicker
        label="操作审批"
        size="small"
        value={automatic ? "" : (config?.approvalMode ?? "ask")}
        disabled={disabled || saving || !config}
        items={[
          ...(automatic ? [{ value: "", label: "旧版自动批准" }] : []),
          ...modes.map((value) => ({ value, label: approvalLabels[value] })),
        ]}
        onValueChange={(value) => {
          if (config && modes.includes(value as ApprovalMode))
            void store.save(
              { ...config, approvalMode: value as ApprovalMode },
              true,
            );
        }}
      />
    </SettingRow>
  );
}
