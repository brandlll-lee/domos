import type { ChatView } from "@domos/agent/view";
import { Button } from "@domos/ui/controls";
import { ModelSelector } from "@domos/ui/model-selector";
import { SettingRow } from "@domos/ui/setting-row";
import { useCallback, useEffect, useState } from "react";
import { client } from "../../client.ts";
import { rejectionMessage } from "../chat/request-error.ts";
import { PiAccountFlow } from "../hosting/model-account-flow.tsx";
import { useModelAccount } from "../hosting/use-model-account.ts";
import { useSettings } from "../settings/context.ts";
import { Effort } from "./effort.tsx";
import { ProviderMark } from "./provider-mark.tsx";
import { modelKey, useModels } from "./use-models.ts";
import { useVisibility } from "./use-visibility.ts";
import "../hosting/models.css";

export function ModelSetting({
  botId,
  model,
  connected,
  disabled,
  onSelected,
  onBusyChange,
}: {
  botId: number;
  model: ChatView["model"];
  connected: boolean;
  disabled?: boolean;
  onSelected?: () => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const settings = useSettings();
  const {
    choices,
    providers,
    error: catalogError,
    refreshProvider,
  } = useModels(connected);
  const visibility = useVisibility(connected);
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState("");
  const [configuring, setConfiguring] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] =
    useState<Awaited<ReturnType<typeof client.engines.get>>>();
  const refresh = useCallback(
    () => client.engines.get({ botId }).then(setProfile),
    [botId],
  );
  useEffect(() => {
    if (!connected) return;
    void refresh().catch(() => setError("模型设置读取失败。请重试。"));
  }, [connected, refresh]);
  const busy = saving || accountBusy;
  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  const selected = choices?.find(
    (item) => model && modelKey(item) === modelKey(model),
  );
  const browsing = providers.find((item) => item.id === provider);
  useEffect(() => {
    setRefreshError(false);
    if (!open || !browsing?.configured || !browsing.dynamic) return;
    const controller = new AbortController();
    setRefreshing(true);
    void refreshProvider(provider, controller.signal)
      .catch(() => {
        if (!controller.signal.aborted) {
          setRefreshError(true);
          setError("模型目录刷新失败。请重试。");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setRefreshing(false);
      });
    return () => {
      controller.abort();
      setRefreshing(false);
    };
  }, [
    open,
    provider,
    browsing?.configured,
    browsing?.dynamic,
    refreshProvider,
  ]);
  const locked = Boolean(disabled || !connected);
  const canConfigure = settings.admin && !settings.standalone;
  const back = useCallback(() => setConfiguring(false), []);
  const configure = () => {
    if (canConfigure) setConfiguring(true);
  };
  async function save(action: () => Promise<unknown>, close = false) {
    setSaving(true);
    setError(null);
    try {
      await action();
      await refresh();
      await onSelected?.();
      if (close) setOpen(false);
    } catch (cause) {
      setError(rejectionMessage(cause) ?? "模型设置保存失败。请重试。");
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <SettingRow
        title="对话模型"
        description={
          <span role="status">{saving ? "正在保存…" : "用于下一次回复。"}</span>
        }
      >
        <ModelSelector
          open={open}
          onOpenChange={(next) => {
            if (next) {
              setProvider(
                model?.provider ??
                  providers.find((item) => item.configured)?.id ??
                  providers[0]?.id ??
                  "",
              );
              setError(null);
              void refresh().catch(() =>
                setError("模型设置读取失败。请重试。"),
              );
            } else setConfiguring(false);
            setOpen(next);
          }}
          providers={providers.map((item) => ({
            ...item,
            icon: <ProviderMark provider={item.id} />,
          }))}
          provider={provider}
          onProviderChange={(id) => {
            setProvider(id);
            setError(null);
            setConfiguring(false);
          }}
          models={(refreshError ? [] : (choices ?? []))
            .filter(
              (item) =>
                item.provider === provider &&
                visibility.visible("pi", `${item.provider}/${item.modelId}`),
            )
            .map((item) => ({ id: modelKey(item), name: item.name }))}
          value={model ? modelKey(model) : ""}
          label={
            selected
              ? `${selected.providerName} · ${selected.name}`
              : model
                ? `${model.provider} / ${model.modelId}（未配置）`
                : "选择模型"
          }
          status={browsing?.configured ? "已连接" : "未连接"}
          loading={choices === null || refreshing}
          disabled={locked}
          busy={busy}
          error={error ?? catalogError ?? visibility.error}
          onConfigure={canConfigure ? configure : undefined}
          notice={
            browsing && !browsing.configured ? (
              <div className="model-selector-notice">
                <p>
                  {canConfigure
                    ? "连接此提供方后选择模型。"
                    : "请管理员连接模型账号。"}
                </p>
                {canConfigure && (
                  <Button
                    size="small"
                    variant="secondary"
                    disabled={locked || busy}
                    onClick={configure}
                  >
                    {browsing.methods.some((method) => method.type === "oauth")
                      ? browsing.methods.some(
                          (method) => method.type === "api_key",
                        )
                        ? "登录 / API 配置"
                        : "登录"
                      : "配置连接"}
                  </Button>
                )}
              </div>
            ) : browsing?.dynamic &&
              (refreshError ||
                !choices?.some((item) => item.provider === provider)) ? (
              <p className="model-selector-note">尚未取得此账号的模型目录。</p>
            ) : undefined
          }
          configuration={
            configuring && canConfigure ? (
              <ProviderConnection
                key={provider}
                provider={provider}
                onBack={back}
                onBusyChange={setAccountBusy}
              />
            ) : undefined
          }
          effort={
            selected?.provider === provider &&
            profile && (
              <Effort
                control={{
                  ...selected.effort,
                  value: profile.config.options.thinkingLevel,
                }}
                disabled={locked || busy}
                onChange={(thinkingLevel) =>
                  void save(() =>
                    client.models.thinking({ botId, thinkingLevel }),
                  )
                }
              />
            )
          }
          onSelect={(value) => {
            const choice = choices?.find((item) => modelKey(item) === value);
            if (choice)
              void save(
                () =>
                  client.models.select({
                    botId,
                    provider: choice.provider,
                    modelId: choice.modelId,
                  }),
                true,
              );
          }}
        />
      </SettingRow>
      <SettingRow
        title="模型账号"
        description={canConfigure ? "连接模型提供方。" : "请管理员管理连接。"}
      >
        <Button
          variant="secondary"
          size="small"
          disabled={locked || busy}
          onClick={() => {
            setProvider(model?.provider ?? providers[0]?.id ?? "");
            setOpen(true);
            setConfiguring(canConfigure);
          }}
        >
          连接模型
        </Button>
      </SettingRow>
      {!open && (error ?? catalogError) && (
        <p className="alert" role="alert">
          {error ?? catalogError}
        </p>
      )}
    </>
  );
}

function ProviderConnection({
  provider,
  onBack,
  onBusyChange,
}: {
  provider: string;
  onBack: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const account = useModelAccount(onBusyChange, provider);
  return (
    <div className="model-selector-connection">
      <Button variant="ghost" size="small" onClick={onBack}>
        返回模型选择
      </Button>
      {!account.catalog && <p role="status">正在读取账号…</p>}
      {account.catalog && (
        <PiAccountFlow
          account={account}
          adding={false}
          manage={account.selected?.configured}
          onAddingChange={onBack}
          onBack={onBack}
        />
      )}
    </div>
  );
}
