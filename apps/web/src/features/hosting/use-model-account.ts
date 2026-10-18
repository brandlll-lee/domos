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

export function useModelAccount(
  onBusyChange?: (busy: boolean) => void,
  initialProvider = "",
) {
  const [catalog, setCatalog] = useState<Catalog>();
  const [provider, setProvider] = useState(initialProvider);
  const [loginId, setLoginId] = useState<string>();
  const [login, setLogin] = useState<Login>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const waiting = Boolean(loginId && !login?.done);
  useEffect(
    () => onBusyChange?.(busy || waiting),
    [busy, waiting, onBusyChange],
  );
  const refresh = useCallback(async () => {
    const value = await hostingRequest<Catalog>("models");
    setCatalog(value);
    setProvider(
      (current) =>
        current || value.providers.find((item) => item.configured)?.id || "",
    );
    window.dispatchEvent(new Event("domos:models"));
  }, []);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
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
        if (controller.signal.aborted) return;
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
  useEffect(
    () => () => {
      if (loginId)
        void hostingRequest(`login/${loginId}`, undefined, "DELETE").catch(
          () => {},
        );
    },
    [loginId],
  );
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
  return {
    catalog,
    provider,
    setProvider: (value: string) => {
      setProvider(value);
      setLoginId(undefined);
      setLogin(undefined);
    },
    login,
    busy,
    waiting,
    error,
    action,
    selected: catalog?.providers.find((item) => item.id === provider),
    connect: (type: string) =>
      action(async () => {
        if (loginId)
          await hostingRequest(`login/${loginId}`, undefined, "DELETE");
        const result = await hostingRequest<{ id: string }>("login", {
          provider,
          type,
        });
        setLogin(undefined);
        setLoginId(result.id);
      }),
    answer: (value: string) =>
      action(async () => {
        if (!login?.prompt) return;
        await hostingRequest(`login/${loginId}`, {
          promptId: login.prompt.id,
          value,
        });
        setLogin((current) =>
          current ? { ...current, prompt: undefined } : current,
        );
      }),
    cancel: () =>
      action(async () => {
        if (loginId)
          await hostingRequest(`login/${loginId}`, undefined, "DELETE");
        setLoginId(undefined);
        setLogin(undefined);
      }),
    disconnect: () =>
      action(async () => {
        await hostingRequest(
          `models/${encodeURIComponent(provider)}`,
          undefined,
          "DELETE",
        );
        await refresh();
      }),
  };
}
