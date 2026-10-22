import { Button } from "@domos/ui/controls";
import { ScrollArea } from "@domos/ui/scroll-area";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { EngineSelect } from "../engine-select.tsx";
import { EngineConnection } from "./engine-connection.tsx";
import { EngineDialog, type EngineDialogKind } from "./engine-dialog.tsx";
import { EngineSource } from "./engine-source.tsx";
import { useEngine } from "./use-engine.ts";
import "./engine.css";

export function EnginePanel({
  botId,
  active = true,
  canManage = false,
  piModel,
  onReady,
  onBack,
  onBusyChange,
}: {
  botId: number;
  active?: boolean;
  canManage?: boolean;
  piModel?: (
    onSelected: () => Promise<void>,
    onBusyChange: (busy: boolean) => void,
  ) => ReactNode;
  onReady?: () => void;
  onBack?: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const setup = useEngine(botId, active);
  const { profile, connection, pending, error } = setup;
  const [dialog, setDialog] = useState<EngineDialogKind | null>(null);
  const [modelBusy, setModelBusy] = useState(false);
  const checked = useRef("");
  const action = useRef<HTMLButtonElement>(null);
  const blocked = Boolean(setup.busy || modelBusy);
  const provider = profile?.config.provider ?? "pi";
  const name =
    profile?.providers.find((item) => item.id === provider)?.name ?? "Pi";
  const status =
    pending === "inspect"
      ? "正在检查…"
      : error
        ? "检查失败"
        : profile?.prepared
          ? "已就绪"
          : connection?.ready === false
            ? "未安装"
            : "待连接";
  useEffect(() => onBusyChange?.(blocked), [blocked, onBusyChange]);
  useEffect(() => {
    if (!active || !onReady || !profile || profile.prepared || blocked || error)
      return;
    if (
      provider === "pi" &&
      !profile.config.model &&
      profile.config.accountSource !== "native"
    )
      return;
    const key = `${botId}:${profile.revision}`;
    if (checked.current === key) return;
    checked.current = key;
    void setup.inspect();
  }, [active, onReady, profile, blocked, error, provider, botId, setup]);
  const close = async () => {
    if (setup.login?.state === "waiting") await setup.cancel();
    setDialog(null);
  };
  return (
    <section
      className="engine-panel"
      data-setup={Boolean(onReady) || undefined}
      aria-label="任务引擎"
      aria-busy={Boolean(pending)}
    >
      <ScrollArea className="engine-scroll">
        <div className="engine-content">
          {!onReady && (
            <header>
              <h3>任务引擎</h3>
              <p className="detail-note">更换后开始新会话，聊天记录会保留。</p>
            </header>
          )}
          {profile ? (
            <EngineSelect
              value={provider}
              disabled={blocked}
              presentation={onReady ? "list" : "menu"}
              status={status}
              onChange={(provider) =>
                void setup.save({ provider, model: null })
              }
            />
          ) : (
            <p role="status">正在读取引擎…</p>
          )}
          <EngineSource setup={setup} disabled={blocked} />
          {provider === "pi" &&
          profile?.config.accountSource !== "native" &&
          piModel ? (
            <>
              {piModel(setup.refresh, setModelBusy)}
              <Button
                ref={action}
                variant="secondary"
                size="small"
                disabled={blocked}
                pending={pending === "inspect"}
                onClick={() => void setup.inspect()}
              >
                {pending === "inspect" ? "正在检查…" : "检查连接"}
              </Button>
            </>
          ) : (
            <EngineConnection
              setup={setup}
              name={name}
              blocked={blocked}
              onConfigure={setDialog}
              actionRef={action}
            />
          )}
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
        </div>
      </ScrollArea>
      {onReady && (
        <footer className="engine-footer">
          <div className="setup-actions">
            {onBack && (
              <Button variant="secondary" disabled={blocked} onClick={onBack}>
                返回
              </Button>
            )}
            <Button
              disabled={blocked || Boolean(error) || !profile?.prepared}
              onClick={onReady}
            >
              开始使用
            </Button>
          </div>
        </footer>
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
