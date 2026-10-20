import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { ChoicePicker } from "@domos/ui/picker";
import { SettingRow } from "@domos/ui/setting-row";
import { useState } from "react";
import { computerLabels } from "../../computer/copy.ts";
import { ComputerLocation } from "../../computer/location.tsx";
import { ComputerServices } from "../../computer/services.tsx";
import type { useComputer } from "../../computer/use-computer.ts";
import { useSettings } from "../../settings/context.ts";

export function ComputerSettings({
  computer,
  botId,
}: {
  computer: ReturnType<typeof useComputer>;
  botId: number;
}) {
  const { status, busy, error, setup, refresh, assign, choices } = computer;
  const settings = useSettings();
  const [location, setLocation] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const ready = () => {
    setLocation(false);
    void refresh();
  };
  return (
    <section className="detail-page" aria-label="工作电脑" aria-busy={busy}>
      <div className="panel-card computer-binding">
        <SettingRow title="工作位置">
          <ChoicePicker
            label="此 Bot 使用的电脑"
            value={status?.id ?? ""}
            disabled={busy}
            onValueChange={(value) => void assign(value || null)}
            items={[
              { value: "", label: "仅聊天" },
              ...choices
                .filter((item) => item.authorized)
                .map((item) => ({ value: item.id, label: item.name })),
            ]}
          />
        </SettingRow>
        <div className="computer-binding-status">
          <span
            className="status-tag"
            data-tone={status?.authorized ? "ready" : "attention"}
          >
            {status
              ? `${computerLabels.state[status.state]} · ${status.authorized ? "已授权" : "待授权"}`
              : "仅聊天"}
          </span>
          {status && (
            <div className="computer-capabilities">
              <span data-on={status.capabilities.commands}>命令</span>
              <span data-on={status.capabilities.files}>文件</span>
            </div>
          )}
        </div>
      </div>
      {busy && <p role="status">正在准备并连接电脑…</p>}
      {status?.error && (
        <p className="alert" role="alert">
          {status.error}
        </p>
      )}
      {status?.authorized && (
        <ComputerServices
          key={status.id}
          botId={botId}
          admin={settings.admin}
        />
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      {settings.admin && (
        <div className="detail-page-head">
          {setup && (
            <Button
              variant="secondary"
              size="small"
              disabled={busy || status?.busy}
              onClick={() => setLocation(true)}
            >
              准备新电脑
            </Button>
          )}
          <Button
            variant="ghost"
            size="small"
            onClick={() => settings.open("computers")}
          >
            管理所有电脑
          </Button>
        </div>
      )}

      <Dialog
        open={location}
        onOpenChange={(open) => {
          if (!preparing) setLocation(open);
        }}
        title="Bot 在哪里工作？"
        description="选择只应用到此 Bot。"
      >
        {setup && (
          <ComputerLocation
            botId={botId}
            canIsolate={setup.canIsolate}
            deployment={setup.deployment}
            onReady={ready}
            onBusyChange={setPreparing}
          />
        )}
        <div className="dialog-actions">
          <Button
            variant="secondary"
            disabled={preparing}
            onClick={() => setLocation(false)}
          >
            取消
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
