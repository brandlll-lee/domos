import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { ChoicePicker } from "@domos/ui/picker";
import { SettingRow } from "@domos/ui/setting-row";
import { useEffect, useState } from "react";
import { ComputerLocation } from "../../computer/location.tsx";
import { ComputerServices } from "../../computer/services.tsx";
import type { useComputer } from "../../computer/use-computer.ts";
import { useModelSettings } from "../../models/model-state.ts";
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
  const { store, profile } = useModelSettings(botId);
  const [profileError, setProfileError] = useState("");
  useEffect(() => {
    void store.load().catch((cause) => setProfileError(cause.message));
  }, [store]);
  const ready = () => {
    setLocation(false);
    void refresh();
  };
  return (
    <section className="detail-page" aria-label="工作电脑" aria-busy={busy}>
      <div className="panel-card computer-binding">
        <SettingRow title="工作电脑">
          <ChoicePicker
            label="此 Bot 使用的电脑"
            value={status?.id ?? ""}
            disabled={busy || !profile}
            onValueChange={(value) => {
              if (!value && profile?.config.provider !== "pi")
                setLocation(true);
              else void assign(value || null);
            }}
            items={[
              ...(profile?.config.provider === "pi" || !status
                ? [
                    {
                      value: "",
                      label:
                        profile?.config.provider === "pi"
                          ? "仅聊天"
                          : "选择工作电脑",
                    },
                  ]
                : []),
              ...choices
                .filter((item) => item.authorized || item.id === status?.id)
                .map((item) => ({
                  value: item.id,
                  label: item.authorized ? item.name : `${item.name}（待授权）`,
                })),
            ]}
          />
        </SettingRow>
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
      {(error || profileError) && (
        <p className="alert" role="alert">
          {error || profileError}
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
        footer={
          <div className="dialog-actions">
            <Button
              variant="secondary"
              disabled={preparing}
              onClick={() => setLocation(false)}
            >
              取消
            </Button>
          </div>
        }
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
      </Dialog>
    </section>
  );
}
