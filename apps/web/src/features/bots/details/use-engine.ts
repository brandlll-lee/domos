import type { EngineConfig } from "@domos/agent/harness/types";
import { useCallback, useEffect, useState } from "react";
import { client } from "../../../client.ts";
import { userError } from "../../user-error.ts";
import { useWorkAction } from "./use-bot-work.ts";

type EngineAction =
  | "read"
  | "inspect"
  | "configure"
  | "key"
  | "install"
  | "login"
  | "cancel"
  | "answer"
  | "controls";
type LoginInput = Omit<Parameters<typeof client.engines.login>[0], "botId">;

export function useEngine(botId: number, active: boolean, running?: boolean) {
  const [profile, setProfile] =
    useState<Awaited<ReturnType<typeof client.engines.get>>>();
  const [connection, setConnection] =
    useState<Awaited<ReturnType<typeof client.engines.inspect>>>();
  const [login, setLogin] =
    useState<Awaited<ReturnType<typeof client.engines.loginState>>>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<EngineAction | null>(null);
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
    setProfile(await client.engines.get({ botId }));
  }, [botId]);
  const inspect = async () => {
    const result = await client.engines.inspect({ botId });
    setConnection(result);
    await refresh();
    return result;
  };
  useEffect(() => {
    if (active)
      void refresh().catch((cause) =>
        setError(userError(cause, "无法读取任务引擎。请重试。")),
      );
  }, [active, refresh]);
  useEffect(() => {
    if (login?.state !== "waiting") return;
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await client.engines.loginState({ botId });
        if (!current) return;
        if (value?.state === "done") {
          const result = await client.engines.inspect({ botId });
          const profile = await client.engines.get({ botId });
          if (!current) return;
          setConnection(result);
          setProfile(profile);
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
  }, [login?.state, botId]);
  return {
    profile,
    connection,
    login,
    pending,
    error: action.error || error,
    busy:
      action.busy || (running ?? profile?.busy) || login?.state === "waiting",
    refresh,
    reload: () => run("read", ["engine", botId], refresh),
    inspect: () => run("inspect", ["inspect", botId], inspect),
    controls: () =>
      run("controls", ["controls", botId], async () => {
        await client.engines.controls({ botId });
        await refresh();
      }),
    save: (config: EngineConfig) =>
      run("configure", ["engine", botId, config], async (requestId) => {
        if (!profile) throw new Error("请等待引擎配置加载。");
        setProfile(
          await client.engines.configure({
            botId,
            config,
            revision: profile.revision,
            requestId,
          }),
        );
        setConnection(undefined);
        setLogin(null);
      }),
    key: (key: string | null, providerId?: string) =>
      run("key", ["key", botId, providerId], async () => {
        await client.engines.key({ botId, key, providerId });
        setConnection(undefined);
        if (key && !(await inspect()).authenticated)
          throw new Error("账号还不可用。请检查连接方式和模型。");
        if (!key) await inspect();
      }),
    install: () =>
      run("install", ["install", botId], async () => {
        await client.engines.install({ botId });
        await inspect();
      }),
    signIn: (input: LoginInput = {}) =>
      run(
        "login",
        ["login", botId, input.providerId, input.method],
        async () => {
          setLogin(await client.engines.login({ botId, ...input }));
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
