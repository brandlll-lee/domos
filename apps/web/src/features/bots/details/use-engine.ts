import type { EngineConfig } from "@domos/agent/harness/types";
import { useCallback, useEffect, useState } from "react";
import { client } from "../../../client.ts";
import { useWorkAction } from "./use-bot-work.ts";

type EngineAction =
  | "read"
  | "inspect"
  | "configure"
  | "key"
  | "install"
  | "login"
  | "cancel";

export function useEngine(botId: number, active: boolean) {
  const [profile, setProfile] =
    useState<Awaited<ReturnType<typeof client.engines.get>>>();
  const [connection, setConnection] =
    useState<Awaited<ReturnType<typeof client.engines.inspect>>>();
  const [login, setLogin] =
    useState<Awaited<ReturnType<typeof client.engines.loginState>>>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<EngineAction | null>(null);
  const action = useWorkAction();
  const run = <T>(
    name: EngineAction,
    key: unknown,
    operation: (requestId: string) => Promise<T>,
  ) =>
    action.run(key, async (requestId) => {
      setPending(name);
      setError("");
      try {
        return await operation(requestId);
      } finally {
        setPending(null);
      }
    });
  const refresh = useCallback(async () => {
    setProfile(await client.engines.get({ botId }));
  }, [botId]);
  const inspect = async () => {
    setConnection(await client.engines.inspect({ botId }));
    await refresh();
  };
  useEffect(() => {
    if (active) void refresh().catch((error) => setError(error.message));
  }, [active, refresh]);
  useEffect(() => {
    if (login?.state !== "waiting") return;
    let current = true;
    const timer = setInterval(() => {
      void client.engines
        .loginState({ botId })
        .then(async (value) => {
          if (!current) return;
          setLogin(value);
          if (value?.state === "done") {
            setConnection(await client.engines.inspect({ botId }));
            await refresh();
          }
        })
        .catch((error) => {
          if (current) {
            setError(error.message);
            setLogin(null);
          }
        });
    }, 1000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [login?.state, botId, refresh]);
  return {
    profile,
    connection,
    login,
    pending,
    error: action.error || error,
    busy: action.busy || profile?.busy || login?.state === "waiting",
    refresh,
    reload: () => run("read", ["engine", botId], refresh),
    inspect: () => run("inspect", ["inspect", botId], inspect),
    save: (config: EngineConfig) =>
      run("configure", ["engine", botId, config], async (requestId) => {
        if (!profile) return;
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
        setError("");
      }),
    key: (key: string | null) =>
      run("key", ["key", botId], async () => {
        await client.engines.key({ botId, key });
        setConnection(undefined);
        if (key) await inspect();
      }),
    install: () =>
      run("install", ["install", botId], async () => {
        await client.engines.install({ botId });
        await inspect();
      }),
    signIn: () =>
      run("login", ["login", botId], async () => {
        setLogin(await client.engines.login({ botId }));
      }),
    cancel: () =>
      run("cancel", ["cancel-login", botId], async () => {
        await client.engines.cancelLogin({ botId });
        setLogin(null);
      }),
  };
}

export type EngineSetup = ReturnType<typeof useEngine>;
