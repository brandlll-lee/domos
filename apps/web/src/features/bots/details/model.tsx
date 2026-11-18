import type { EngineConfig } from "@domos/agent/harness/types";
import { Button } from "@domos/ui/controls";
import { DialogFooter } from "@domos/ui/dialog";
import { Loading } from "@domos/ui/loading";
import { SetupStatus } from "@domos/ui/setup";
import { StartupScene } from "@domos/ui/startup";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { useCallback, useEffect, useState } from "react";
import { client } from "../../../client.ts";
import { ComputerPermission } from "../../computer/permission.tsx";
import { ModelSetting } from "../../models/model-setting.tsx";
import { useModelSettings } from "../../models/model-state.ts";
import { useSettings } from "../../settings/context.ts";
import { EngineMark } from "../engine-mark.tsx";

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
            <EngineMark provider={item.id} />
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
            <CaretRightIcon aria-hidden="true" />
          </Button>
        );
      });
    if (onboarding)
      return (
        <StartupScene
          title="连接你的 AI"
          signal="[ BOT ] → [ AGENT ]"
          description="选择一个 Agent 引擎来执行任务。"
        >
          <section
            className="startup-branches startup-engines"
            aria-label="Agent 引擎"
          >
            {branches(providers.filter((item) => item.id !== "acp"))}
            <Button
              variant="ghost"
              className="startup-branch"
              onClick={onboarding.skip}
            >
              <span className="startup-branch-copy">
                <strong>暂时跳过</strong>
                <small>进入工作区后可新建 Bot 或设置模型</small>
              </span>
            </Button>
          </section>
          {providers.some((item) => item.id === "acp") && (
            <Button variant="ghost" onClick={() => setProvider("acp")}>
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
        title="允许访问电脑"
        signal="[ AGENT ] → [ PC ]"
        back={busy ? undefined : goBack}
      >
        {permission}
      </StartupScene>
    ) : (
      permission
    );
  }
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
      <DialogFooter>
        <div className="setup-actions">
          {onReady && (
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
          )}
          {setup && !onboarding && back}
        </div>
      </DialogFooter>
      {onboarding?.issue && <p role="alert">{onboarding.issue}</p>}
    </div>
  );
  return onboarding ? (
    <StartupScene
      title="给 Bot 选一个模型"
      signal="[ MSG ] → [ MODEL ]"
      back={busy ? undefined : goBack}
    >
      {model}
    </StartupScene>
  ) : (
    model
  );
}
