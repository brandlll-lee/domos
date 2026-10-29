import type { EngineConfig } from "@domos/agent/harness/types";
import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { ModelSelector } from "@domos/ui/model-selector";
import { ChoicePicker, SearchPicker } from "@domos/ui/picker";
import { SettingRow } from "@domos/ui/setting-row";
import { useEffect, useState } from "react";
import { client } from "../../client.ts";
import { EngineMark } from "../bots/engine-mark.tsx";
import { useSettings } from "../settings/context.ts";
import { Effort } from "./effort.tsx";
import { useVisibility } from "./use-visibility.ts";

export function ModelSetting({
  botId,
  connected,
  disabled,
  onBusyChange,
  onProfile,
}: {
  botId: number;
  connected: boolean;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onProfile?: (profile: Awaited<ReturnType<typeof client.engines.get>>) => void;
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
  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    void client.engines.get({ botId }, { signal: controller.signal }).then(
      (next) => {
        if (controller.signal.aborted) return;
        setProfile(next);
        onProfile?.(next);
        setConfig(next.config);
        setConnection(next.connection ?? undefined);
        setControls(next.runtime?.controls);
        setArgs(JSON.stringify(next.config.args ?? []));
      },
      (cause) => {
        if (!controller.signal.aborted) setError(cause.message);
      },
    );
    return () => controller.abort();
  }, [connected, botId, onProfile]);
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
  async function inspect() {
    let selected = config;
    if (config.provider === "acp") {
      try {
        const parsed: unknown = JSON.parse(args);
        if (
          !Array.isArray(parsed) ||
          parsed.some((value) => typeof value !== "string")
        )
          throw new Error();
        selected = { ...config, args: parsed };
      } catch {
        throw new Error("启动参数必须是 JSON 字符串数组。");
      }
    }
    setConfig(selected);
    const value = await client.engines.inspect({
      botId,
      config: selected,
      refresh: true,
    });
    setConnection(value);
    if ("controls" in value) setControls(value.controls);
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
    setProfile(saved);
    onProfile?.(saved);
    setConfig(saved.config);
    setControls(nextControls);
    if (close) setOpen(false);
  }
  useEffect(() => {
    if (!connected || !profile || config.provider === "acp") return;
    let current = true;
    void (
      settings.admin
        ? client.engines.inspect({ botId, config, refresh: open })
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
  }, [connected, open, profile, botId, config, settings.admin]);
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
  function field({
    items,
    key,
    ...props
  }: Parameters<typeof TextField>[0] & {
    items?: { value: string; label: string }[];
    key?: string;
  }) {
    return items ? (
      <ChoicePicker key={key} disabled={locked} {...props} items={items} />
    ) : (
      <TextField key={key} disabled={locked} {...props} />
    );
  }
  function action(
    label: string,
    callback: () => Promise<unknown>,
    blocked = false,
  ) {
    return (
      <Button
        variant="secondary"
        size="small"
        disabled={locked || blocked}
        onClick={() => void run(callback)}
      >
        {label}
      </Button>
    );
  }
  return (
    <>
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
            setConfig(
              provider === profile?.config.provider
                ? profile.config
                : { provider, model: null },
            );
            setConfiguring(provider === "acp");
            setLogin(null);
          }}
          models={(
            connection?.models ??
            profile?.catalog.find((item) => item.id === config.provider)
              ?.models ??
            []
          ).filter((model) => visibility.visible(config.provider, model.id))}
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
            busy ? (
              <p role="status">正在保存…</p>
            ) : settings.admin ? (
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
            )
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
                {config.provider === "acp" && (
                  <>
                    {field({
                      label: "程序路径",
                      value: config.command ?? "",
                      onValueChange: (command) =>
                        setConfig({ ...config, command }),
                    })}
                    {field({
                      label: "启动参数",
                      value: args,
                      onValueChange: setArgs,
                    })}
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
                    {field({
                      label: "登录方式",
                      value: method,
                      onValueChange: setMethod,
                      items: methods.map((method, index) => ({
                        value: String(index),
                        label: method.label,
                      })),
                      disabled: locked || login?.state === "waiting",
                    })}
                    {methods[Number(method)]?.prompts
                      ?.filter(
                        (prompt) =>
                          !prompt.when ||
                          (prompt.when.op === "eq"
                            ? inputs[prompt.when.key] === prompt.when.value
                            : inputs[prompt.when.key] !== prompt.when.value),
                      )
                      .map((prompt) =>
                        field({
                          key: prompt.key,
                          label: prompt.message,
                          value: inputs[prompt.key] ?? "",
                          items:
                            prompt.type === "select"
                              ? (prompt.options ?? [])
                              : undefined,
                          onValueChange: (value) =>
                            setInputs({ ...inputs, [prompt.key]: value }),
                        }),
                      )}
                  </>
                )}
                <div className="dialog-actions">
                  {action("检查连接", () => inspect())}
                  {settings.admin && config.provider !== "acp" && (
                    <>
                      {action(
                        connection?.ready ? "下载独立版本" : "下载",
                        async () => {
                          const installed = await client.engines.install({
                            botId,
                            config,
                          });
                          setConfig(installed.config);
                          setConnection(installed.connection);
                        },
                      )}
                      {action(
                        "登录",
                        async () =>
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
                        login?.state === "waiting" ||
                          (config.provider === "opencode" && !account),
                      )}
                    </>
                  )}
                  {connection?.authenticated &&
                    !connection.models.length &&
                    action("使用默认模型", () =>
                      save({ ...config, model: null }),
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
                      field({
                        label: login.prompt,
                        value: code,
                        onValueChange: setCode,
                        type: login.secret ? "password" : "text",
                        items: login.options?.map((value) => ({
                          value,
                          label: value,
                        })),
                        disabled: busy,
                      })}
                    <div className="dialog-actions">
                      {login.prompt &&
                        action("继续", () =>
                          client.engines.answerLogin({ botId, code }),
                        )}
                      {action("检查登录", async () => {
                        setLogin(await client.engines.loginState({ botId }));
                        await inspect();
                      })}
                      {action("取消", async () => {
                        await client.engines.cancelLogin({ botId });
                        setLogin(null);
                      })}
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
      {error && !open && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
