import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { ChoicePicker } from "@domos/ui/picker";
import { SettingRow } from "@domos/ui/setting-row";
import { useCallback, useEffect, useState } from "react";
import { client } from "../../client.ts";
import { hostingRequest } from "./api.ts";

type Catalog = {
  providers: {
    id: string;
    name: string;
    configured: boolean;
    methods: { type: string; name: string }[];
  }[];
  models: { provider: string; modelId: string; name: string }[];
};
type Login = {
  done: boolean;
  error?: string;
  events: {
    id: string;
    type: string;
    message?: string;
    url?: string;
    verificationUri?: string;
    userCode?: string;
  }[];
  prompt?: {
    id: string;
    type: string;
    message: string;
    options?: { id: string; label: string }[];
  };
};

export function HostingModels({
  onConfigured,
  botId,
}: {
  onConfigured: () => void;
  botId?: number;
}) {
  const [catalog, setCatalog] = useState<Catalog>();
  const [provider, setProvider] = useState("");
  const [loginId, setLoginId] = useState<string>();
  const [login, setLogin] = useState<Login>();
  const [value, setValue] = useState("");
  const [selection, setSelection] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(
    () =>
      hostingRequest<Catalog>("models").then((value) => {
        setCatalog(value);
        window.dispatchEvent(new Event("domos:models"));
      }),
    [],
  );
  useEffect(() => {
    void refresh().catch((error) => setError(error.message));
  }, [refresh]);
  useEffect(() => {
    if (!loginId) return;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const result = await hostingRequest<Login>(
          `login/${loginId}`,
          undefined,
          "GET",
          controller.signal,
        );
        setLogin(result);
        if (result.done) {
          await refresh();
          clearInterval(timer);
        }
      } catch (error) {
        if (!controller.signal.aborted) setError((error as Error).message);
      }
    };
    const timer = setInterval(() => void poll(), 750);
    void poll();
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [loginId, refresh]);
  const action = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await run();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(
    () => () => {
      if (loginId)
        void hostingRequest(`login/${loginId}`, undefined, "DELETE").catch(
          () => {},
        );
    },
    [loginId],
  );
  const selected = catalog?.providers.find((item) => item.id === provider);
  const prompt = login?.prompt;
  return (
    <section
      className="settings-sections"
      aria-label="模型配置"
      aria-busy={busy}
      data-dirty={Boolean(value || selection || (loginId && !login?.done))}
    >
      <section className="settings-group">
        <h2>连接模型</h2>
        <div className="settings-card">
          <SettingRow title="模型提供方" description="连接用于对话的模型账号。">
            <ChoicePicker
              label="模型提供方"
              size="small"
              value={provider}
              disabled={busy}
              onValueChange={setProvider}
              items={[
                { value: "", label: "选择提供方" },
                ...(catalog?.providers.map((item) => ({
                  value: item.id,
                  label: `${item.name}${item.configured ? " · 已连接" : ""}`,
                })) ?? []),
              ]}
            />
          </SettingRow>
          {selected?.methods.map((method) => (
            <SettingRow
              key={method.type}
              title={method.name}
              description={`连接 ${selected.name} 账号。`}
            >
              <Button
                variant="secondary"
                size="small"
                aria-label={method.name}
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await hostingRequest("login", undefined, "DELETE");
                    const result = await hostingRequest<{ id: string }>(
                      "login",
                      {
                        provider,
                        type: method.type,
                      },
                    );
                    setLogin(undefined);
                    setLoginId(result.id);
                    setValue("");
                  })
                }
              >
                {selected.configured ? "重新连接" : "连接"}
              </Button>
            </SettingRow>
          ))}
          {selected?.configured && (
            <SettingRow
              title="账号状态"
              description="此提供方的模型已可用于对话。"
            >
              <Button
                variant="secondary"
                size="small"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await hostingRequest(
                      `models/${encodeURIComponent(provider)}`,
                      undefined,
                      "DELETE",
                    );
                    await refresh();
                  })
                }
              >
                断开模型账号
              </Button>
            </SettingRow>
          )}
        </div>
      </section>
      {login?.events.map((event) => (
        <p key={event.id} className="detail-note">
          {event.message} {event.userCode}
          {(event.url ?? event.verificationUri)?.startsWith("https://") && (
            <a
              href={event.url ?? event.verificationUri}
              target="_blank"
              rel="noreferrer"
            >
              打开登录页面
            </a>
          )}
        </p>
      ))}
      {prompt && (
        <form
          className="settings-form settings-card"
          onSubmit={(event) => {
            event.preventDefault();
            void action(async () => {
              await hostingRequest(`login/${loginId}`, {
                promptId: prompt.id,
                value,
              });
              setValue("");
              setLogin((current) =>
                current ? { ...current, prompt: undefined } : current,
              );
            });
          }}
        >
          {prompt.options ? (
            <div className="field">
              <label className="field-label" htmlFor="model-login-input">
                {prompt.message}
              </label>
              <ChoicePicker
                id="model-login-input"
                label={prompt.message}
                value={value}
                onValueChange={setValue}
                disabled={busy}
                items={[
                  { value: "", label: "请选择" },
                  ...prompt.options.map((item) => ({
                    value: item.id,
                    label: item.label,
                  })),
                ]}
              />
            </div>
          ) : (
            <TextField
              label={prompt.message}
              type={prompt.type === "secret" ? "password" : "text"}
              value={value}
              autoComplete="off"
              onValueChange={setValue}
              disabled={busy}
            />
          )}
          <div className="form-actions">
            <Button size="small" disabled={busy || !value} type="submit">
              继续
            </Button>
          </div>
        </form>
      )}
      {login?.error && <p role="alert">{login.error}</p>}
      {loginId && !login?.done && (
        <div className="form-actions">
          <Button
            variant="secondary"
            size="small"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await hostingRequest("login", undefined, "DELETE");
                setLoginId(undefined);
                setLogin(undefined);
              })
            }
          >
            取消登录
          </Button>
        </div>
      )}
      {botId !== undefined && (
        <section className="settings-group">
          <h3>对话模型</h3>
          <div className="settings-card">
            <SettingRow
              title="此 Bot 的模型"
              description="选择此 Bot 用于回复消息的模型。"
            >
              <ChoicePicker
                label="此 Bot 的模型"
                size="small"
                value={selection}
                disabled={busy}
                onValueChange={setSelection}
                items={[
                  { value: "", label: "选择已连接的模型" },
                  ...(catalog?.models.map((item) => ({
                    value: JSON.stringify({
                      provider: item.provider,
                      modelId: item.modelId,
                    }),
                    label: item.name,
                  })) ?? []),
                ]}
              />
            </SettingRow>
          </div>
          {selection && (
            <div className="form-actions">
              <Button
                size="small"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await client.models.select({
                      botId,
                      ...JSON.parse(selection),
                    });
                    window.dispatchEvent(new Event("domos:models"));
                    onConfigured();
                  })
                }
              >
                保存模型
              </Button>
            </div>
          )}
        </section>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
