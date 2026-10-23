import type { EngineConfig, EngineId } from "@domos/agent/harness/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "../../../client.ts";
import { userError } from "../../user-error.ts";
import { useWorkAction } from "./use-bot-work.ts";
import { useEngineCatalog } from "./use-engine-catalog.ts";

type EngineAction =
  | "read"
  | "inspect"
  | "key"
  | "install"
  | "login"
  | "cancel"
  | "answer"
  | "controls";
type LoginInput = Omit<Parameters<typeof client.engines.login>[0], "botId">;

export function useEngine(
  botId: number,
  active: boolean,
  running?: boolean,
  provider?: EngineId,
  computerId?: string,
) {
  const [profile, setProfile] =
    useState<Awaited<ReturnType<typeof client.engines.get>>>();
  const [connection, setConnection] =
    useState<Awaited<ReturnType<typeof client.engines.inspect>>>();
  const [login, setLogin] =
    useState<Awaited<ReturnType<typeof client.engines.loginState>>>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<EngineAction | null>(null);
  const [saving, setSaving] = useState(false);
  const confirmed = useRef(profile);
  const selection = useRef(profile);
  const queue = useRef(Promise.resolve(true));
  const version = useRef(0);
  const saves = useRef(0);
  const controlsRequest = useRef<Promise<boolean> | null>(null);
  const catalog = useEngineCatalog(botId, active, profile?.config, computerId);
  const action = useWorkAction();
  const run = async <T>(
    name: EngineAction,
    key: unknown,
    operation: (requestId: string) => Promise<T>,
  ) => {
    let success = false;
    await action.run(
      key,
      async (requestId) => {
        setPending(name);
        setError("");
        try {
          return await operation(requestId);
        } finally {
          setPending(null);
        }
      },
      () => {
        success = true;
      },
    );
    return success;
  };
  const refresh = useCallback(async () => {
    const next = await client.engines.get({ botId });
    if (next.revision < (confirmed.current?.revision ?? 0)) return;
    confirmed.current = next;
    if (!saves.current) {
      selection.current = next;
      setProfile(next);
    }
  }, [botId]);
  const inspect = async (force = false) => {
    const result = await client.engines.inspect({
      botId,
      provider,
      refresh: force,
    });
    setConnection(result);
    await refresh();
    return result;
  };
  useEffect(() => {
    if (computerId) setConnection(undefined);
    if (active)
      void refresh().catch((cause) =>
        setError(userError(cause, "无法读取任务引擎。请重试。")),
      );
  }, [active, refresh, computerId]);
  useEffect(() => {
    if (login?.state !== "waiting") return;
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await client.engines.loginState({ botId });
        if (!current) return;
        if (value?.state === "done") {
          const result = await client.engines.inspect({ botId, provider });
          const profile = await client.engines.get({ botId });
          if (!current) return;
          setConnection(result);
          confirmed.current = profile;
          selection.current = profile;
          setProfile(profile);
          window.dispatchEvent(new Event("domos:engines"));
        }
        setError("");
        setLogin(value);
        if (value?.state !== "waiting") return;
      } catch (cause) {
        if (current) setError(userError(cause, "登录状态读取失败，请重试。"));
      }
      if (current) timer = setTimeout(() => void poll(), 1000);
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [login?.state, botId, provider]);
  return {
    profile:
      profile && provider
        ? {
            ...profile,
            config:
              provider === profile.config.provider
                ? profile.config
                : { provider, model: null },
          }
        : profile,
    connection,
    catalog,
    saving,
    login,
    pending,
    error: action.error || error,
    busy:
      action.busy ||
      (provider
        ? provider === profile?.config.provider && profile.busy
        : (running ?? profile?.busy)) ||
      login?.state === "waiting",
    refresh,
    reload: () => run("read", ["engine", botId], refresh),
    inspect: (refresh = true) =>
      run("inspect", ["inspect", botId, provider], async () => {
        await inspect(refresh);
        if (refresh) window.dispatchEvent(new Event("domos:engines"));
      }),
    controls: () => {
      if (controlsRequest.current) return controlsRequest.current;
      const previous = selection.current;
      setPending("controls");
      const request = client.engines
        .controls({ botId })
        .then((controls) => {
          if (previous && selection.current === previous && !saves.current) {
            const next = {
              ...previous,
              runtime: { ...previous.runtime, controls },
            };
            confirmed.current = next;
            selection.current = next;
            setProfile(next);
          }
          return true;
        })
        .catch((cause) => {
          if (!saves.current)
            setError(userError(cause, "原生配置读取失败。请重试。"));
          return false;
        })
        .finally(() => {
          controlsRequest.current = null;
          setPending(null);
        });
      controlsRequest.current = request;
      return request;
    },
    save: (input: EngineConfig) => {
      const previous = selection.current;
      if (
        !previous ||
        action.busy ||
        running ||
        previous.busy ||
        login?.state === "waiting"
      )
        return Promise.resolve(false);
      const config = {
        ...input,
        accountSource:
          input.accountSource ??
          (input.provider === previous.config.provider
            ? previous.config.accountSource
            : undefined),
      };
      const current = ++version.current;
      saves.current++;
      action.clear();
      setSaving(true);
      setError("");
      selection.current = {
        ...previous,
        config,
        model: null,
        runtime:
          previous.config.provider === config.provider &&
          previous.config.model === config.model &&
          (previous.config.accountSource ?? "managed") ===
            (config.accountSource ?? "managed")
            ? previous.runtime
            : null,
      };
      setProfile(selection.current);
      const requestId = crypto.randomUUID();
      const save = queue.current.then(async () => {
        try {
          await controlsRequest.current;
          const model = config.model;
          const next =
            previous.providers.length === 1 && config.provider === "pi" && model
              ? await (async () => {
                  const separator = model.indexOf("/");
                  await client.models.select({
                    botId,
                    provider: model.slice(0, separator),
                    modelId: model.slice(separator + 1),
                  });
                  return client.engines.get({ botId });
                })()
              : await client.engines.configure({
                  botId,
                  config,
                  revision: confirmed.current?.revision ?? previous.revision,
                  requestId,
                });
          confirmed.current = next;
          if (current === version.current) {
            selection.current = next;
            setProfile(next);
          }
          if (
            config.provider !== previous.config.provider ||
            config.accountSource !== previous.config.accountSource
          )
            setConnection(undefined);
          setLogin(null);
          return true;
        } catch (cause) {
          await refresh().catch(() => {});
          if (current === version.current) {
            selection.current = confirmed.current;
            setProfile(confirmed.current);
            setError(userError(cause, "配置保存失败。请重试。"));
          }
          return false;
        } finally {
          if (!--saves.current) setSaving(false);
        }
      });
      queue.current = save;
      return save;
    },
    key: (key: string | null, providerId?: string) =>
      run("key", ["key", botId, providerId], async () => {
        await client.engines.key({ botId, provider, key, providerId });
        const result = await inspect();
        const authenticated =
          providerId && "accounts" in result
            ? result.accounts?.providers.some(
                (item) => item.id === providerId && item.connected,
              )
            : result.authenticated;
        if (key && !authenticated)
          throw new Error("账号还不可用。请检查连接方式和模型。");
        window.dispatchEvent(new Event("domos:engines"));
      }),
    install: () =>
      run("install", ["install", botId], async () => {
        await client.engines.install({ botId, provider });
        await inspect();
        window.dispatchEvent(new Event("domos:engines"));
      }),
    signIn: (input: LoginInput = {}) =>
      run(
        "login",
        ["login", botId, input.providerId, input.method],
        async () => {
          setLogin(await client.engines.login({ botId, provider, ...input }));
        },
      ),
    answerLogin: (code: string) =>
      run("answer", ["login-answer", botId], async () => {
        await client.engines.answerLogin({ botId, code });
        setLogin((current) =>
          current?.state === "waiting" ? { ...current, prompt: null } : current,
        );
      }),
    cancel: () =>
      run("cancel", ["cancel-login", botId], async () => {
        await client.engines.cancelLogin({ botId });
        setLogin(null);
      }),
  };
}

export type EngineSetup = ReturnType<typeof useEngine>;
