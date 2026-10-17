import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { ChoicePicker } from "@domos/ui/picker";
import { SettingRow } from "@domos/ui/setting-row";
import { useState } from "react";
import { useSettings } from "../settings/context.ts";
import { computerLabels } from "./copy.ts";
import { ComputerLocation } from "./location.tsx";
import type { useComputer } from "./use-computer.ts";

export function ComputerPanel({
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
  const [advanced, setAdvanced] = useState(false);
  const ready = () => {
    setLocation(false);
    void refresh();
  };
  return (
    <section className="detail-stack" aria-label="工作环境" aria-busy={busy}>
      <p className="detail-note">
        选择此 Bot 使用的电脑。Domos 会自动准备并连接。
      </p>
      {!status && settings.admin && setup ? (
        <ComputerLocation
          botId={botId}
          canIsolate={setup.canIsolate}
          deployment={setup.deployment}
          onReady={ready}
        />
      ) : (
        !status && (
          <p role="status">
            {setup ? "请让管理员选择运行位置。" : "正在读取工作环境…"}
          </p>
        )
      )}
      {busy && <p role="status">正在准备并连接电脑…</p>}
      {status && (
        <div className="settings-card">
          <SettingRow
            title={status.name}
            description={`${computerLabels.state[status.state]} · ${status.authorized ? "已授权" : "授权已撤销"}`}
          >
            <span className="status-label">
              {status.capabilities.commands && status.capabilities.files
                ? "可用"
                : "待连接"}
            </span>
          </SettingRow>
          <div className="computer-capabilities settings-form">
            <span>
              {status.capabilities.commands ? "✓ 可执行命令" : "命令暂不可用"}
            </span>
            <span>
              {status.capabilities.files ? "✓ 可处理文件" : "文件暂不可用"}
            </span>
          </div>
        </div>
      )}
      {status?.error && (
        <p role="alert" className="alert">
          {status.error}
        </p>
      )}
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        {settings.admin && status && setup && (
          <Button
            variant="secondary"
            size="small"
            disabled={busy || status.busy}
            onClick={() => setLocation(true)}
          >
            更换工作环境
          </Button>
        )}
        <Button
          variant="ghost"
          size="small"
          onClick={() => setAdvanced(!advanced)}
          aria-expanded={advanced}
        >
          高级选项
        </Button>
      </div>
      {advanced && (
        <div className="detail-stack">
          <div className="field">
            <span className="field-label">连接已有电脑</span>
            <ChoicePicker
              label="连接已有电脑"
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
          </div>
          {settings.admin && (
            <Button
              variant="secondary"
              size="small"
              onClick={() => settings.open("computers")}
            >
              电脑高级管理
            </Button>
          )}
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
