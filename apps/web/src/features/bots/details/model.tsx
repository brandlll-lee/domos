import type { EngineConfig } from "@domos/agent/harness/types";
import { Button } from "@domos/ui/controls";
import { DialogFooter } from "@domos/ui/dialog";
import { Loading } from "@domos/ui/loading";
import { SetupStatus } from "@domos/ui/setup";
import { StartupScene } from "@domos/ui/startup";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { type CSSProperties, useCallback, useEffect, useState } from "react";
import { client } from "../../../client.ts";
import { ComputerPermission } from "../../computer/permission.tsx";
import { ModelSetting } from "../../models/model-setting.tsx";
import { useModelSettings } from "../../models/model-state.ts";
import { useSettings } from "../../settings/context.ts";
import { EngineMark } from "../engine-mark.tsx";

const engineOrder = [
  "pi",
  "codex",
  "claude",
  "opencode",
  "cursor",
  "antigravity",
  "grok",
  "devin",
];

export function ModelSetup({
  botId,
  onBusyChange,
  onReady,
  onboarding,
}: {
  botId: number;
  onBusyChange?: (busy: boolean) => void;
  onReady?: () => void;
  onboarding?: { issue: string; skip: () => void };
}) {
  const settings = useSettings();
  const setup = Boolean(onReady);
  const { profile, store } = useModelSettings(botId);
  const [binding, setBinding] =
    useState<Awaited<ReturnType<typeof client.computer.get>>>();
  const [provider, setProvider] = useState<EngineConfig["provider"]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reportBusy = useCallback(
    (value: boolean) => {
      setBusy(value);
      onBusyChange?.(value);
    },
    [onBusyChange],
  );
  const refresh = useCallback(
    async (reload = false) => {
      const [binding] = await Promise.all([
        client.computer.get({ botId }),
        store.load(reload),
      ]);
      setBinding(binding);
    },
    [botId, store],
  );
  useEffect(() => {
    void refresh().catch((cause) => setError(cause.message));
  }, [refresh]);
  useEffect(() => {
    if (!setup && profile) setProvider(profile.config.provider);
  }, [setup, profile]);
  if (!binding || !profile)
    return error ? (
      <p role="alert">{error}</p>
    ) : setup ? (
      <SetupStatus>正在读取连接…</SetupStatus>
    ) : (
      <Loading label="正在读取连接" />
    );
  const providers = profile.providers.filter(
    (item) => settings.admin || item.id === profile.config.provider,
  );
  if (!provider) {
    const branches = (items: typeof providers) =>
      items.map((item) => {
        const choice = store.snapshot().choices[item.id];
        const connection = store.connection(
          choice ?? { provider: item.id, model: null },
        );
        return (
          <Button
            key={item.id}
            variant="ghost"
            className={onboarding ? "startup-branch" : "setup-provider"}
            aria-label={item.name}
            disabled={profile.busy}
            onClick={() => setProvider(item.id)}
          >
            {onboarding ? (
              <span
                className="engine-mark startup-engine-mark"
                aria-hidden="true"
                style={
                  {
                    "--mark-index": engineOrder.indexOf(item.id),
                  } as CSSProperties
                }
              />
            ) : (
              <EngineMark provider={item.id} />
            )}
            {onboarding ? (
              <span className="startup-branch-copy">
                <strong>{item.name}</strong>
                <small>
                  {connection?.version && `v${connection.version} · `}
                  {connection
                    ? connection.ready
                      ? connection.authenticated
                        ? "可用"
                        : "需登录"
                      : "未就绪"
                    : "未检查"}
                </small>
              </span>
            ) : (
              <span>{item.name}</span>
            )}
            {!onboarding &&
              profile.connection?.ready &&
              profile.config.provider === item.id && (
                <span className="setup-provider-status">
                  {profile.connection.authenticated ? "已连接" : "待登录"}
                </span>
              )}
            {onboarding ? (
              <span className="startup-arrow" aria-hidden="true">
                →
              </span>
            ) : (
              <CaretRightIcon aria-hidden="true" />
            )}
          </Button>
        );
      });
    if (onboarding)
      return (
        <StartupScene
          stop="engine"
          title="连接你的 AI"
          description="选择 Agent 引擎。引擎让 Bot 能执行任务。"
        >
          <section
            className="startup-branches startup-engines"
            aria-label="Agent 引擎"
          >
            {branches(
              engineOrder.flatMap((id) =>
                providers.filter((item) => item.id === id),
              ),
            )}
            <Button
              variant="ghost"
              className="startup-branch"
              onClick={onboarding.skip}
            >
              <span className="startup-branch-copy">
                <strong>暂时跳过</strong>
                <small>进入工作区后，可以随时创建 Bot</small>
              </span>
              <span className="startup-arrow" aria-hidden="true">
                →
              </span>
            </Button>
          </section>
          {providers.some((item) => item.id === "acp") && (
            <Button
              variant="ghost"
              className="startup-extra"
              onClick={() => setProvider("acp")}
            >
              自定义 ACP
            </Button>
          )}
        </StartupScene>
      );
    return (
      <section className="setup-providers" aria-label="可用连接">
        {branches(providers)}
      </section>
    );
  }
  const goBack = () => {
    if (!busy) setProvider(undefined);
  };
  const back = (
    <Button variant="secondary" disabled={busy} onClick={goBack}>
      返回
    </Button>
  );
  if (!binding.computer?.authorized) {
    const permission = (
      <ComputerPermission
        botId={botId}
        onReady={() => refresh(true)}
        onBusyChange={reportBusy}
        footer={onboarding ? undefined : back}
        illustrated={!onboarding}
      />
    );
    return onboarding ? (
      <StartupScene
        stop="access"
        title="允许访问电脑"
        description="等你确认，Domos 才会连接这台电脑。"
        back={busy ? undefined : goBack}
      >
        {permission}
      </StartupScene>
    ) : (
      permission
    );
  }
  const continueAction = onReady && (
    <Button
      disabled={
        busy ||
        profile.config.provider !== provider ||
        !(profile.revision || profile.prepared)
      }
      onClick={onReady}
    >
      开始聊天
    </Button>
  );
  const model = (
    <div className="model-setup">
      <ModelSetting
        key={provider}
        botId={botId}
        connected
        disabled={profile.busy}
        setupProvider={setup ? provider : undefined}
        guided={Boolean(onboarding)}
        onBusyChange={reportBusy}
      />
      {!onboarding && (
        <DialogFooter>
          <div className="setup-actions">
            {continueAction}
            {setup && back}
          </div>
        </DialogFooter>
      )}
      {onboarding?.issue && <p role="alert">{onboarding.issue}</p>}
    </div>
  );
  return onboarding ? (
    <StartupScene
      stop="model"
      title="给 Bot 选一个模型"
      description={providers.find((item) => item.id === provider)?.name}
      back={busy ? undefined : goBack}
      footer={continueAction}
    >
      {model}
    </StartupScene>
  ) : (
    model
  );
}
