import { Button, Switch } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { SettingRow } from "@domos/ui/setting-row";
import { useState } from "react";
import { ComputerDecision } from "./decision.tsx";
import { serviceLabels, useComputerServices } from "./use-services.ts";

export function ComputerServices({
  botId,
  admin,
}: {
  botId: number;
  admin: boolean;
}) {
  const { state, busy, error, configure, changeMode, reload } =
    useComputerServices(botId);
  const [mode, setMode] = useState<"headless" | "headed">();
  return (
    <section className="detail-stack" aria-label="浏览器和桌面">
      <div className="detail-form-head">
        <h3 className="panel-group-title">允许的操作</h3>
      </div>
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
              setMode(state.browser.mode === "headed" ? "headless" : "headed")
            }
          >
            {state.browser.mode === "headed"
              ? "切换为无界面"
              : "尝试有界面模式"}
          </Button>
        </SettingRow>
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
      <div className="panel-card computer-services">
        {(["browser", "desktop"] as const).map((service) => (
          <SettingRow
            key={service}
            title={serviceLabels[service]}
            description={state?.[service].enabled ? "已允许" : "未允许"}
          >
            <Switch
              label={`允许${serviceLabels[service]}`}
              checked={state?.[service].enabled ?? false}
              disabled={!admin || Boolean(busy) || !state}
              onCheckedChange={(enabled) => void configure(service, enabled)}
            />
          </SettingRow>
        ))}
      </div>
      <ComputerDecision botId={botId} admin={admin} />
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      {error && !state && (
        <Button variant="secondary" size="small" onClick={reload}>
          重新连接
        </Button>
      )}
    </section>
  );
}
