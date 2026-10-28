import type { EngineConfig } from "@domos/agent/harness/types";
import type { ChatView } from "@domos/agent/view";
import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { ModelSelector } from "@domos/ui/model-selector";
import { ChoicePicker, SearchPicker } from "@domos/ui/picker";
import { SettingRow } from "@domos/ui/setting-row";
import { useCallback, useEffect, useState } from "react";
import { client } from "../../client.ts";
import { EngineMark } from "../bots/engine-mark.tsx";
import { useSettings } from "../settings/context.ts";
import { Effort } from "./effort.tsx";
import { useVisibility } from "./use-visibility.ts";

export function ModelSetting({
  botId,
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
  const visibility = useVisibility(connected);
  const [profile, setProfile] =
    useState<Awaited<ReturnType<typeof client.engines.get>>>();
  const [config, setConfig] = useState<EngineConfig>({
    provider: "pi",
    model: null,
  });
  const [connection, setConnection] =
    useState<Awaited<ReturnType<typeof client.engines.inspect>>>();
  const [login, setLogin] =
    useState<Awaited<ReturnType<typeof client.engines.loginState>>>();
  const [controls, setControls] =
    useState<Awaited<ReturnType<typeof client.engines.controls>>>();
  const [code, setCode] = useState("");
  const [account, setAccount] = useState("");
  const [method, setMethod] = useState("0");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [args, setArgs] = useState("[]");
  const [open, setOpen] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const next = await client.engines.get({ botId });
    setProfile(next);
    setConfig(next.config);
    setControls(next.runtime?.controls);
    setArgs(JSON.stringify(next.config.args ?? []));
  }, [botId]);
  useEffect(() => {
    if (connected) void refresh().catch((e) => setError(e.message));
  }, [connected, refresh]);
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作未完成。");
    } finally {
      setBusy(false);
    }
  }
  async function inspect(next = config) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(args);
    } catch {
      throw new Error("启动参数必须是 JSON 字符串数组。");
    }
    if (
      !Array.isArray(parsed) ||
      !parsed.every((value) => typeof value === "string")
    )
      throw new Error("启动参数必须是 JSON 字符串数组。");
    const selected = next.provider === "acp" ? { ...next, args: parsed } : next;
    setConfig(selected);
    setConnection(
      await client.engines.inspect({ botId, config: selected, refresh: true }),
    );
  }
  async function save(next: EngineConfig, close = true) {
    if (!profile) return;
    const input = {
      botId,
      config: { ...next, command: connection?.path ?? next.command },
      revision: profile.revision,
      requestId: crypto.randomUUID(),
    };
    const saved = settings.admin
      ? await client.engines.configure(input)
      : await client.engines.select({
          botId,
          model: next.model,
          options: next.options,
          revision: input.revision,
          requestId: input.requestId,
        });
    const nextControls = await client.engines.controls({ botId });
    await onSelected?.();
    setProfile(saved);
    setConfig(saved.config);
    setControls(nextControls);
    if (close) setOpen(false);
  }
  useEffect(() => {
    if (!open || config.provider === "acp") return;
    let current = true;
    setConnection(undefined);
    void (
      settings.admin
        ? client.engines.inspect({ botId, config })
        : client.engines.available({ botId })
    ).then(
      (value) => {
        if (current) {
          setConnection(value);
          if ("controls" in value) setControls(value.controls);
        }
      },
      (cause) => {
        if (current) setError(cause.message);
      },
    );
    return () => {
      current = false;
    };
  }, [open, botId, config, settings.admin]);
  useEffect(() => {
    if (login?.state !== "waiting") return;
    let current = true;
    const timer = setInterval(() => {
      void client.engines
        .loginState({ botId })
        .then(async (next) => {
          if (!current) return;
          setLogin(next);
          if (next?.state === "done") {
            setCode("");
            const value = await client.engines.inspect({
              botId,
              config,
              refresh: true,
            });
            if (current) setConnection(value);
          }
        })
        .catch((error) => {
          if (current) setError(error.message);
        });
    }, 1000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [login?.state, botId, config]);
  useEffect(() => {
    setCode("");
  }, []);
  const locked = Boolean(disabled || profile?.busy || busy || !settings.admin);
  const providers = (profile?.providers ?? []).filter(
    (provider) => settings.admin || provider.id === profile?.config.provider,
  );
  const accounts =
    connection && "accounts" in connection
      ? (connection.accounts?.providers ?? [])
      : [];
  const methods =
    accounts.find((provider) => provider.id === account)?.methods ?? [];
  return (
    <div className="detail-stack">
      <SettingRow title="运行模型">
        <ModelSelector
          open={open}
          onOpenChange={setOpen}
          providers={providers.map((item) => ({
            ...item,
            icon: <EngineMark provider={item.id} />,
            configured:
              item.id === profile?.config.provider && profile.prepared,
          }))}
          provider={config.provider}
          onProviderChange={(provider) => {
            setConnection(undefined);
            setControls(undefined);
            setError("");
            setConfig({ provider, model: null });
            setConfiguring(provider === "acp");
            setLogin(null);
          }}
          models={(connection?.models ?? []).filter((model) =>
            visibility.visible(config.provider, model.id),
          )}
          value={profile?.config.model ?? ""}
          label={
            profile?.model?.name ??
            profile?.config.model ??
            "选择 Harness 和模型"
          }
          loading={!profile}
          disabled={Boolean(disabled)}
          busy={busy || login?.state === "waiting"}
          error={error}
          onSelect={(model) =>
            void run(() => save({ ...config, model, options: undefined }))
          }
          status={connection ? connection.message : ""}
          onConfigure={settings.admin ? () => setConfiguring(true) : undefined}
          notice={
            <>
              {busy && <p role="status">正在保存…</p>}
              {settings.admin ? (
                <Button
                  variant="ghost"
                  size="small"
                  disabled={locked}
                  onClick={() => setConfiguring(true)}
                >
                  配置连接
                </Button>
              ) : (
                <p className="detail-note">账号和程序由管理员配置。</p>
              )}
            </>
          }
          configuration={
            configuring ? (
              <div className="model-selector-connection">
                <Button
                  variant="ghost"
                  size="small"
                  disabled={busy || login?.state === "waiting"}
                  onClick={() => setConfiguring(false)}
                >
                  返回模型
                </Button>
                {busy && (
                  <p role="status" className="detail-note">
                    正在保存…
                  </p>
                )}
                {config.provider === "acp" && (
                  <>
                    <TextField
                      label="程序路径"
                      value={config.command ?? ""}
                      onValueChange={(command) =>
                        setConfig({ ...config, command })
                      }
                      disabled={locked || !settings.admin}
                    />
                    <TextField
                      label="启动参数"
                      value={args}
                      onValueChange={setArgs}
                      disabled={locked || !settings.admin}
                    />
                  </>
                )}
                {connection?.version && (
                  <SettingRow title="版本">{connection.version}</SettingRow>
                )}
                {connection?.path && (
                  <SettingRow title="程序路径">
                    <span className="detail-note">{connection.path}</span>
                  </SettingRow>
                )}
                {config.provider === "opencode" && (
                  <>
                    <SearchPicker
                      label="模型提供方"
                      placeholder="选择提供方"
                      searchLabel="搜索提供方"
                      emptyLabel="没有匹配的提供方"
                      value={account}
                      onValueChange={(value) => {
                        setAccount(value);
                        setMethod("0");
                        setInputs({});
                      }}
                      items={accounts.map((provider) => ({
                        value: provider.id,
                        label: provider.name,
                      }))}
                      disabled={locked || login?.state === "waiting"}
                    />
                    <ChoicePicker
                      label="登录方式"
                      value={method}
                      onValueChange={setMethod}
                      items={methods.map((method, index) => ({
                        value: String(index),
                        label: method.label,
                      }))}
                      disabled={locked || login?.state === "waiting"}
                    />
                    {methods[Number(method)]?.prompts
                      ?.filter(
                        (prompt) =>
                          !prompt.when ||
                          (prompt.when.op === "eq"
                            ? inputs[prompt.when.key] === prompt.when.value
                            : inputs[prompt.when.key] !== prompt.when.value),
                      )
                      .map((prompt) =>
                        prompt.type === "select" ? (
                          <ChoicePicker
                            key={prompt.key}
                            label={prompt.message}
                            value={inputs[prompt.key] ?? ""}
                            items={prompt.options ?? []}
                            onValueChange={(value) =>
                              setInputs({ ...inputs, [prompt.key]: value })
                            }
                            disabled={locked}
                          />
                        ) : (
                          <TextField
                            key={prompt.key}
                            label={prompt.message}
                            value={inputs[prompt.key] ?? ""}
                            onValueChange={(value) =>
                              setInputs({ ...inputs, [prompt.key]: value })
                            }
                            disabled={locked}
                          />
                        ),
                      )}
                  </>
                )}
                <div className="dialog-actions">
                  <Button
                    variant="secondary"
                    size="small"
                    disabled={locked}
                    onClick={() => void run(() => inspect())}
                  >
                    检查连接
                  </Button>
                  {settings.admin && config.provider !== "acp" && (
                    <Button
                      variant="secondary"
                      size="small"
                      disabled={locked}
                      onClick={() =>
                        void run(async () => {
                          const installed = await client.engines.install({
                            botId,
                            config,
                          });
                          setConfig(installed.config);
                          setConnection(installed.connection);
                        })
                      }
                    >
                      {connection?.ready ? "下载独立版本" : "下载"}
                    </Button>
                  )}
                  {settings.admin && config.provider !== "acp" && (
                    <Button
                      size="small"
                      disabled={
                        locked ||
                        login?.state === "waiting" ||
                        (config.provider === "opencode" && !account)
                      }
                      onClick={() =>
                        void run(async () =>
                          setLogin(
                            await client.engines.login({
                              botId,
                              providerId: account || undefined,
                              method: Number(method),
                              inputs,
                              config: {
                                ...config,
                                command: connection?.path ?? config.command,
                              },
                            }),
                          ),
                        )
                      }
                    >
                      登录
                    </Button>
                  )}
                  {connection?.authenticated && !connection.models.length && (
                    <Button
                      size="small"
                      disabled={locked}
                      onClick={() =>
                        void run(() => save({ ...config, model: null }))
                      }
                    >
                      使用默认模型
                    </Button>
                  )}
                </div>
                {login && (
                  <div className="detail-stack">
                    {login.state !== "waiting" && (
                      <p role="status">
                        {login.state === "done" ? "已登录" : "登录未完成"}
                      </p>
                    )}
                    {login.url && (
                      <a href={login.url} target="_blank" rel="noreferrer">
                        打开登录页面
                      </a>
                    )}
                    {login.code && <code>{login.code}</code>}
                    {login.instructions && (
                      <p className="detail-note">{login.instructions}</p>
                    )}
                    {login.prompt &&
                      (login.options ? (
                        <ChoicePicker
                          label={login.prompt}
                          value={code}
                          items={login.options.map((value) => ({
                            value,
                            label: value,
                          }))}
                          onValueChange={setCode}
                          disabled={busy}
                        />
                      ) : (
                        <TextField
                          label={login.prompt}
                          type={login.secret ? "password" : "text"}
                          value={code}
                          onValueChange={setCode}
                        />
                      ))}
                    <div className="dialog-actions">
                      {login.prompt && (
                        <Button
                          disabled={locked}
                          onClick={() =>
                            void run(() =>
                              client.engines.answerLogin({ botId, code }),
                            )
                          }
                        >
                          继续
                        </Button>
                      )}
                      <Button
                        disabled={locked}
                        onClick={() =>
                          void run(async () => {
                            setLogin(
                              await client.engines.loginState({ botId }),
                            );
                            await inspect();
                          })
                        }
                      >
                        检查登录
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={locked}
                        onClick={() =>
                          void run(async () => {
                            await client.engines.cancelLogin({ botId });
                            setLogin(null);
                          })
                        }
                      >
                        取消
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : undefined
          }
          effort={controls?.options
            .filter((item) => item.kind === "effort")
            .map((control) => (
              <Effort
                key={control.id}
                control={control}
                disabled={locked}
                onChange={(value) =>
                  void run(() => {
                    const options = { ...config.options };
                    if (value) options[control.id] = value;
                    else delete options[control.id];
                    return save({ ...config, options }, false);
                  })
                }
              />
            ))}
        />
      </SettingRow>
      {busy && (
        <p role="status" className="detail-note">
          正在保存…
        </p>
      )}
      {error && !open && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
