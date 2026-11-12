import type { EngineConfig } from "@domos/agent/harness/types";
import { Button, Switch } from "@domos/ui/controls";
import { Disclosure } from "@domos/ui/disclosure";
import { SearchField } from "@domos/ui/field";
import { Loading } from "@domos/ui/loading";
import { InlineNotice } from "@domos/ui/message";
import { PanelGroup } from "@domos/ui/panel";
import { ChoicePicker } from "@domos/ui/picker";
import { SettingRow } from "@domos/ui/setting-row";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { useEffect, useState } from "react";
import { client } from "../../client.ts";
import { EngineMark } from "../bots/engine-mark.tsx";
import { ModelSetting } from "../models/model-setting.tsx";
import { useModelSettings } from "../models/model-state.ts";
import { useVisibility } from "../models/use-visibility.ts";
import { userError } from "../user-error.ts";
import { useConnectionContext } from "./use-connection-context.ts";

export function AISettings({
  botId,
  admin,
}: {
  botId?: number;
  admin: boolean;
}) {
  const [selected, setSelected] = useState(botId);
  const [bots, setBots] =
    useState<Awaited<ReturnType<typeof client.bots.list>>>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (selected !== undefined) return;
    const controller = new AbortController();
    void client.bots
      .list(undefined, { signal: controller.signal })
      .then(setBots, (cause) => {
        if (!controller.signal.aborted)
          setError(userError(cause, "配置范围读取失败。"));
      });
    return () => controller.abort();
  }, [selected]);
  if (selected !== undefined)
    return <Services key={selected} botId={selected} admin={admin} />;
  if (error) return <InlineNotice className="alert">{error}</InlineNotice>;
  if (!bots) return <Loading label="正在读取工作环境" />;
  if (!bots.length)
    return (
      <InlineNotice>创建 Bot 后，可以管理其工作电脑上的 AI 服务。</InlineNotice>
    );
  return (
    <SettingRow
      title="工作环境"
      description="选择 Bot，查看其工作电脑和目录中的服务连接。"
    >
      <ChoicePicker
        label="工作环境"
        value=""
        items={bots.map((bot) => ({ value: String(bot.id), label: bot.name }))}
        onValueChange={(value) => setSelected(Number(value))}
      />
    </SettingRow>
  );
}

function Services({ botId, admin }: { botId: number; admin: boolean }) {
  const { store, profile, selected } = useModelSettings(botId);
  const context = useConnectionContext(botId);
  const [provider, setProvider] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void store
      .load()
      .catch((cause) => setError(userError(cause, "服务目录读取失败。")));
  }, [store]);
  const scope = context.data;
  const providers = (profile?.providers ?? []).filter(
    (item) => admin || item.id === profile?.config.provider,
  );
  const configFor = (id: string): EngineConfig =>
    selected?.provider === id
      ? selected
      : (store.snapshot().choices[id] ?? { provider: id, model: null });
  const enabled = Boolean(scope?.computer?.authorized);
  useEffect(() => {
    if (!profile || !enabled) return;
    for (const item of profile.providers) {
      if (!admin && item.id !== profile.config.provider) continue;
      const config =
        profile.config.provider === item.id
          ? profile.config
          : (store.snapshot().choices[item.id] ?? {
              provider: item.id,
              model: null,
            });
      if (item.id === "acp" && !config.command) continue;
      void store.inspect(config, admin).catch(() => {});
    }
  }, [profile, enabled, admin, store]);
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      await Promise.all([store.load(true), context.store.load(true)]);
      if (context.store.snapshot().data?.computer?.authorized)
        await Promise.all(
          providers
            .filter((item) => item.id !== "acp" || configFor(item.id).command)
            .map((item) =>
              store.inspect(configFor(item.id), admin, true).catch(() => {}),
            ),
        );
    } catch (cause) {
      setError(userError(cause, "服务目录读取失败。"));
    } finally {
      setBusy(false);
    }
  }
  const active = providers.find((item) => item.id === provider);
  return (
    <div className="settings-sections ai-services" aria-busy={busy}>
      <div className="section-heading">
        {active ? (
          <Button
            variant="ghost"
            size="small"
            disabled={busy}
            onClick={() => setProvider(undefined)}
          >
            <ArrowLeftIcon />
            返回 AI 服务
          </Button>
        ) : (
          <h3>服务连接</h3>
        )}
        {!active && (
          <Button
            variant="ghost"
            size="small"
            pending={busy}
            onClick={() => void refresh()}
          >
            重新检查
          </Button>
        )}
      </div>
      {scope && (
        <PanelGroup title="工作环境">
          <SettingRow title="工作电脑">
            {scope.computer?.name ?? "未分配工作电脑"}
          </SettingRow>
          <SettingRow title="工作目录">
            <span className="ai-scope-path">
              {scope.directory ?? "Bot 个人目录"}
            </span>
          </SettingRow>
        </PanelGroup>
      )}
      {!scope && !context.error && <Loading label="正在读取工作环境" inline />}
      {Boolean(error || context.error) && (
        <InlineNotice className="alert">
          {error || userError(context.error, "工作环境读取失败。")}
        </InlineNotice>
      )}
      {!profile && !error && <Loading label="正在读取服务目录" inline />}
      {scope && !enabled && (
        <InlineNotice>请先在 Bot 的电脑设置中分配并授权工作电脑。</InlineNotice>
      )}
      {active ? (
        <>
          <PanelGroup title={active.name}>
            <div className="ai-service-detail">
              <div className="provider-row">
                <EngineMark provider={active.id} />
                <h3>{active.name}</h3>
              </div>
              <ModelSetting
                key={active.id}
                botId={botId}
                connected={enabled}
                disabled={!enabled}
                setupProvider={active.id}
                connectionOnly
                onBusyChange={setBusy}
              />
            </div>
          </PanelGroup>
          <ServiceModels
            botId={botId}
            config={configFor(active.id)}
            name={active.name}
            admin={admin}
          />
        </>
      ) : (
        <PanelGroup title="可用服务">
          {providers.map((item) => {
            const config = configFor(item.id);
            const connection = store.connection(config);
            const failure = store.inspectionError(config);
            const loading = store.inspecting(config);
            const label = !enabled ? (
              "等待工作电脑授权"
            ) : failure ? (
              "读取失败"
            ) : loading ? (
              <Loading label="正在检查连接" inline />
            ) : connection ? (
              !connection.ready ? (
                "未安装"
              ) : connection.authenticated ? (
                "可用"
              ) : (
                "待登录"
              )
            ) : item.id === "acp" ? (
              "待配置"
            ) : (
              <Loading label="正在检查连接" inline />
            );
            return (
              <div className="ai-service-row" key={item.id}>
                <span className="ai-service-mark">
                  <EngineMark provider={item.id} />
                </span>
                <SettingRow
                  title={item.name}
                  description={
                    <span
                      role={typeof label === "string" ? "status" : undefined}
                      title={failure || connection?.message}
                    >
                      {label}
                    </span>
                  }
                >
                  <Button
                    variant="secondary"
                    size="small"
                    aria-label={`${connection?.authenticated && !failure ? "管理" : "设置"} ${item.name}`}
                    onClick={() => setProvider(item.id)}
                  >
                    {connection?.authenticated && !failure ? "管理" : "设置"}
                  </Button>
                </SettingRow>
              </div>
            );
          })}
        </PanelGroup>
      )}
      {!admin && <InlineNotice>账号和程序由管理员配置。</InlineNotice>}
    </div>
  );
}

function ServiceModels({
  botId,
  config,
  name,
  admin,
}: {
  botId: number;
  config: EngineConfig;
  name: string;
  admin: boolean;
}) {
  const { store, profile } = useModelSettings(botId);
  const visibility = useVisibility(true);
  const [query, setQuery] = useState("");
  const models =
    store.connection(config)?.models ??
    profile?.catalog.find((item) => item.id === config.provider)?.models ??
    [];
  const matches = models.filter((item) =>
    `${item.name} ${item.id} ${item.group ?? ""}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <Disclosure label="显示哪些模型" className="model-catalog">
      <SearchField
        aria-label="搜索模型"
        value={query}
        onValueChange={setQuery}
        placeholder="搜索名称或模型 ID"
      />
      <PanelGroup title="模型选择器">
        {matches.map((item) => (
          <SettingRow key={item.id} title={item.name} description={item.group}>
            <Switch
              label={`${name} · ${item.name}`}
              checked={visibility.visible(config.provider, item.id)}
              disabled={!admin || visibility.pending}
              onCheckedChange={(visible) =>
                void visibility.save(config.provider, item.id, visible)
              }
            />
          </SettingRow>
        ))}
        {!matches.length && (
          <SettingRow title={query ? "没有匹配的模型" : "尚无可用模型"}>
            {null}
          </SettingRow>
        )}
      </PanelGroup>
      {visibility.error && (
        <InlineNotice className="alert">{visibility.error}</InlineNotice>
      )}
    </Disclosure>
  );
}
