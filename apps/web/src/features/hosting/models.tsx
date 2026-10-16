import { Button } from "@domos/ui/controls";
import { useCallback, useEffect, useState } from "react";
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

export function HostingModels({ onConfigured }: { onConfigured: () => void }) {
  const [catalog, setCatalog] = useState<Catalog>();
  const [provider, setProvider] = useState("");
  const [loginId, setLoginId] = useState<string>();
  const [login, setLogin] = useState<Login>();
  const [value, setValue] = useState("");
  const [selection, setSelection] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(
    () => hostingRequest<Catalog>("models").then(setCatalog),
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
  const selected = catalog?.providers.find((item) => item.id === provider);
  const prompt = login?.prompt;
  return (
    <section className="hosting-stack" aria-label="模型配置" aria-busy={busy}>
      <h2>连接模型</h2>
      <label>
        模型提供方
        <select
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
        >
          <option value="">选择提供方</option>
          {catalog?.providers.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
              {item.configured ? " · 已连接" : ""}
            </option>
          ))}
        </select>
      </label>
      {selected?.methods.map((method) => (
        <Button
          key={method.type}
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void action(async () => {
              await hostingRequest("login", undefined, "DELETE");
              const result = await hostingRequest<{ id: string }>("login", {
                provider,
                type: method.type,
              });
              setLogin(undefined);
              setLoginId(result.id);
              setValue("");
            })
          }
        >
          {method.name}
        </Button>
      ))}
      {selected?.configured && (
        <Button
          variant="ghost"
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
      )}
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
          className="hosting-stack"
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
          <label htmlFor="model-login-input">
            {prompt.message}
            {prompt.options ? (
              <select
                id="model-login-input"
                value={value}
                onChange={(event) => setValue(event.target.value)}
              >
                <option value="">请选择</option>
                {prompt.options.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="model-login-input"
                type={prompt.type === "secret" ? "password" : "text"}
                value={value}
                autoComplete="off"
                onChange={(event) => setValue(event.target.value)}
              />
            )}
          </label>
          <Button disabled={busy || !value} type="submit">
            继续
          </Button>
        </form>
      )}
      {login?.error && <p role="alert">{login.error}</p>}
      {loginId && !login?.done && (
        <Button
          variant="ghost"
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
      )}
      <label>
        默认模型
        <select
          value={selection}
          onChange={(event) => setSelection(event.target.value)}
        >
          <option value="">选择已连接的模型</option>
          {catalog?.models.map((item) => (
            <option
              key={`${item.provider}/${item.modelId}`}
              value={JSON.stringify({
                provider: item.provider,
                modelId: item.modelId,
              })}
            >
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <Button
        disabled={busy || !selection}
        onClick={() =>
          void action(async () => {
            await hostingRequest("setup", JSON.parse(selection));
            onConfigured();
          })
        }
      >
        保存并使用
      </Button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
