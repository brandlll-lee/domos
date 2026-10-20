import type { ChatView } from "@domos/agent/view";
import { Button } from "@domos/ui/controls";
import { SettingRow } from "@domos/ui/setting-row";
import { useRef, useState } from "react";
import { ModelSetting } from "../../models/model-setting.tsx";
import { EngineSelect } from "../engine-select.tsx";
import { EngineConnection } from "./engine-connection.tsx";
import { EngineDialog, type EngineDialogKind } from "./engine-dialog.tsx";
import type { EngineSetup } from "./use-engine.ts";

export function EngineSettings({
  botId,
  setup,
  canManage,
  model,
  connected,
}: {
  botId: number;
  setup: EngineSetup;
  canManage: boolean;
  model: ChatView["model"];
  connected: boolean;
}) {
  const [dialog, setDialog] = useState<EngineDialogKind | null>(null);
  const [modelBusy, setModelBusy] = useState(false);
  const action = useRef<HTMLButtonElement>(null);
  const blocked = Boolean(setup.busy || modelBusy);
  const provider = setup.profile?.config.provider ?? "pi";
  const name =
    setup.profile?.providers.find((item) => item.id === provider)?.name ??
    "任务引擎";
  const checking = setup.pending === "inspect";
  const status = checking
    ? "正在检查…"
    : setup.error
      ? "检查失败"
      : setup.profile?.prepared
        ? "已就绪"
        : setup.connection?.ready === false
          ? "未安装"
          : "待连接";
  const pi = provider === "pi";
  const close = async () => {
    if (setup.login?.state === "waiting") await setup.cancel();
    setDialog(null);
  };
  return (
    <section className="detail-page" aria-label="任务引擎">
      <div className="detail-card engine-settings">
        <EngineSelect
          value={provider}
          disabled={blocked || !setup.profile}
          status={status}
          onChange={(next) => void setup.save({ provider: next, model: null })}
        />
        {pi ? (
          <>
            <ModelSetting
              botId={botId}
              model={model}
              connected={connected}
              disabled={Boolean(setup.busy)}
              onSelected={setup.refresh}
              onBusyChange={setModelBusy}
            />
            <SettingRow title={name} description={status}>
              <Button
                ref={action}
                variant="secondary"
                size="small"
                disabled={blocked}
                pending={checking}
                onClick={() => void setup.inspect()}
              >
                {checking ? "正在检查…" : "检查连接"}
              </Button>
            </SettingRow>
          </>
        ) : (
          <EngineConnection
            setup={setup}
            name={name}
            blocked={blocked}
            actionRef={action}
            onConfigure={setDialog}
          />
        )}
      </div>
      {setup.error && (
        <p className="alert" role="alert">
          {setup.error}
        </p>
      )}
      <EngineDialog
        dialog={dialog}
        name={name}
        botId={botId}
        setup={setup}
        canManage={canManage}
        onModelBusyChange={setModelBusy}
        onDialogChange={setDialog}
        onClose={() => void close()}
        finalFocus={() => action.current}
      />
    </section>
  );
}
