import { Button, Switch } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { PanelGroup } from "@domos/ui/panel";
import { SettingRow } from "@domos/ui/setting-row";
import { useState } from "react";
import { ComputerDecision } from "./decision.tsx";
import { useComputerServices } from "./use-services.ts";

export function ComputerServices({
  botId,
  admin,
  configuring,
  onConfigure,
}: {
  botId: number;
  admin: boolean;
  configuring: boolean;
  onConfigure: () => void;
}) {
  const { state, busy, error, configure, changeMode, reload } =
    useComputerServices(botId, !configuring);
  const [mode, setMode] = useState<"headless" | "headed">();
  return (
    <>
      {!configuring && (
        <PanelGroup title="电脑权限">
          <SettingRow
            title="浏览器"
            description={state?.browser.enabled ? "已允许" : "未允许"}
          >
            <Switch
              label="允许浏览器"
              checked={state?.browser.enabled ?? false}
              disabled={!admin || Boolean(busy) || !state}
              onCheckedChange={(enabled) => void configure("browser", enabled)}
            />
          </SettingRow>
          {state?.browser.enabled && (
            <SettingRow
              title="浏览器模式"
              description={
                state.browser.mode === "headed"
                  ? "有界面 · Agent 专用浏览器"
                  : state.browser.mode === "headless"
                    ? "无界面 · Agent 专用浏览器"
                    : "模式待确认"
              }
            >
              <Button
                variant="secondary"
                size="small"
                disabled={!admin || Boolean(busy) || !state.browser.mode}
                onClick={() =>
                  setMode(
                    state.browser.mode === "headed" ? "headless" : "headed",
                  )
                }
              >
                {state.browser.mode === "headed"
                  ? "切换为无界面"
                  : "尝试有界面模式"}
              </Button>
            </SettingRow>
          )}
          <SettingRow
            title="桌面"
            description={state?.desktop.enabled ? "已允许" : "未允许"}
          >
            <Switch
              label="允许桌面"
              checked={state?.desktop.enabled ?? false}
              disabled={!admin || Boolean(busy) || !state}
              onCheckedChange={(enabled) => void configure("desktop", enabled)}
            />
          </SettingRow>
        </PanelGroup>
      )}
      <Dialog
        open={Boolean(mode)}
        onOpenChange={(open) => {
          if (!busy && !open) setMode(undefined);
        }}
        className="decision-dialog"
        title="重启并切换浏览器？"
        description="当前标签页和未提交的内容会关闭。保存的登录信息继续使用。请先结束电脑任务并交还控制权。有界面浏览器会在 Bot 的工作电脑上打开。切换不保证网站放行。"
        footer={
          <div className="dialog-actions">
            <Button
              variant="secondary"
              disabled={Boolean(busy)}
              onClick={() => setMode(undefined)}
            >
              取消
            </Button>
            <Button
              pending={busy === "browser"}
              onClick={() => {
                if (mode)
                  void changeMode(mode).then((ok) => {
                    if (ok) setMode(undefined);
                  });
              }}
            >
              确认重启
            </Button>
          </div>
        }
      >
        {error && <p role="alert">{error}</p>}
      </Dialog>
      <ComputerDecision
        botId={botId}
        admin={admin}
        configuring={configuring}
        onConfigure={onConfigure}
      />
      {!configuring && error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      {!configuring && error && !state && (
        <Button variant="secondary" size="small" onClick={reload}>
          重新连接
        </Button>
      )}
    </>
  );
}
