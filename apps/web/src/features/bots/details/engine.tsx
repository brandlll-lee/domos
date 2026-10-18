import { Button } from "@domos/ui/controls";
import { ScrollArea } from "@domos/ui/scroll-area";
import { type ReactNode, type Ref, useEffect, useRef, useState } from "react";
import { EngineSelect } from "../engine-select.tsx";
import { EngineDialog, type EngineDialogKind } from "./engine-dialog.tsx";
import { type EngineSetup, useEngine } from "./use-engine.ts";
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
  const prepared = useRef(false);
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
    if (provider === "pi" && !profile.config.model) return;
    const key = `${botId}:${profile.revision}`;
    if (checked.current === key) return;
    checked.current = key;
    void setup.inspect();
  }, [active, onReady, profile, blocked, error, provider, botId, setup]);
  useEffect(() => {
    if (blocked) return;
    if (profile?.prepared && !prepared.current) setDialog(null);
    if (
      dialog === "account" &&
      setup.login?.state === "done" &&
      profile?.prepared
    )
      setDialog(null);
    prepared.current = Boolean(profile?.prepared);
    if (dialog === "install" && connection?.ready)
      setDialog(profile?.prepared ? null : "account");
  }, [
    profile?.prepared,
    dialog,
    connection?.ready,
    blocked,
    setup.login?.state,
  ]);
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
          {provider === "pi" && piModel ? (
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
        onClose={() => void close()}
        finalFocus={() => action.current}
      />
    </section>
  );
}

function EngineConnection({
  setup,
  name,
  blocked,
  onConfigure,
  actionRef,
}: {
  setup: EngineSetup;
  name: string;
  blocked: boolean;
  onConfigure: (dialog: EngineDialogKind) => void;
  actionRef: Ref<HTMLButtonElement>;
}) {
  const { profile, connection, pending, error } = setup;
  const checking = pending === "inspect";
  const missing = connection?.ready === false;
  const pi = profile?.config.provider === "pi";
  const needsCheck = Boolean(error || (!pi && !connection));
  let label = "连接账号";
  let description = "使用已安装的程序，连接你的账号。";
  if (pi) {
    label = "连接模型";
    description = "连接模型账号，选择一个模型。";
  }
  if (missing) {
    label = `安装 ${name}`;
    description = "这台工作电脑还未安装此引擎。";
  }
  if (profile?.prepared) {
    label = pi ? "更改模型" : "账号设置";
    description = "已连接，可以开始工作。";
  }
  if (needsCheck) label = error ? "重新检查" : "检查连接";
  if (checking) {
    label = "正在检查…";
    description = "正在检查这台工作电脑。";
  }
  return (
    <div className="engine-connection">
      <div className="engine-connection-copy" role="status">
        <strong>
          {name}
          {connection?.version && (
            <span className="engine-version">{connection.version}</span>
          )}
        </strong>
        <p className="detail-note">{description}</p>
      </div>
      <Button
        ref={actionRef}
        variant="secondary"
        size="small"
        disabled={blocked}
        pending={checking}
        onClick={() => {
          if (!profile) void setup.reload();
          else if (needsCheck) void setup.inspect();
          else onConfigure(missing ? "install" : pi ? "model" : "account");
        }}
      >
        {profile ? label : error ? "重新读取" : "正在读取…"}
      </Button>
      {connection?.ready && !needsCheck && (
        <div className="engine-connection-actions">
          {!pi && connection.authenticated && (
            <Button
              variant="ghost"
              size="small"
              disabled={blocked}
              onClick={() => onConfigure("model")}
            >
              选择模型
            </Button>
          )}
          <Button
            variant="ghost"
            size="small"
            disabled={blocked}
            pending={checking}
            onClick={() => void setup.inspect()}
          >
            重新检查
          </Button>
        </div>
      )}
    </div>
  );
}
