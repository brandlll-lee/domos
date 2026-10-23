import { Button } from "@domos/ui/controls";
import { SettingRow } from "@domos/ui/setting-row";
import { useRef, useState } from "react";
import { EngineConnection } from "./engine-connection.tsx";
import { EngineDialog, type EngineDialogKind } from "./engine-dialog.tsx";
import { EngineSource } from "./engine-source.tsx";
import type { EngineSetup } from "./use-engine.ts";

export function EngineSettings({
  botId,
  setup,
  canManage,
}: {
  botId: number;
  setup: EngineSetup;
  canManage: boolean;
}) {
  const [dialog, setDialog] = useState<EngineDialogKind | null>(null);
  const [modelBusy, setModelBusy] = useState(false);
  const action = useRef<HTMLButtonElement>(null);
  const blocked = Boolean(
    setup.busy || setup.saving || setup.pending === "controls" || modelBusy,
  );
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
        <EngineSource setup={setup} disabled={blocked} />
        {pi && setup.profile?.config.accountSource !== "native" ? (
          <SettingRow title={name} description={status}>
            <Button
              ref={action}
              variant="secondary"
              size="small"
              disabled={blocked}
              onClick={() => setDialog("model")}
            >
              账号设置
            </Button>
            <Button
              variant="secondary"
              size="small"
              disabled={blocked}
              pending={checking}
              onClick={() => void setup.inspect()}
            >
              {checking ? "正在检查…" : "检查连接"}
            </Button>
          </SettingRow>
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
