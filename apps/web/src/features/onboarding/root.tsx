import { StartupPages } from "@domos/ui/startup";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { client } from "../../client.ts";
import { authorizeComputer } from "../computer/permission.tsx";
import { ModelSetting } from "../models/model-setting.tsx";
import { readModelSettings, useModelSettings } from "../models/model-state.ts";
import type { SettingsAccess } from "../settings/sections.tsx";
import { saveWorkspaceView, workspaceView } from "../shell/workspace-state.ts";

type Setup = {
  botId: number;
  bot: string;
  binding: Awaited<ReturnType<typeof client.computer.get>>;
  engine: Awaited<ReturnType<typeof readModelSettings>>;
  ready: boolean;
};
export function Onboarding({
  children,
  admin,
  standalone,
}: SettingsAccess & { children: ReactNode }) {
  const [setup, setSetup] = useState<Setup>();
  const [error, setError] = useState("");
  const [finished, setFinished] = useState(
    () => workspaceView().onboardingDeferred === true,
  );
  const refresh = useCallback(async () => {
    setError("");
    const bot = (await client.bots.list())[0];
    if (!bot) throw new Error("未找到初始 Bot。请重新连接 Domos。");
    const [binding, engine] = await Promise.all([
      client.computer.get({ botId: bot.id }),
      readModelSettings(bot.id),
    ]);
    const next = {
      botId: bot.id,
      bot: bot.name,
      binding,
      engine,
      ready: Boolean(
        binding.computer?.authorized &&
          (engine.revision > 0 || engine.prepared),
      ),
    };
    setSetup(next);
    return next;
  }, []);
  const initialize = useCallback(async () => {
    setFinished((await refresh()).ready);
  }, [refresh]);
  useEffect(() => {
    if (!finished) void initialize().catch((cause) => setError(cause.message));
  }, [finished, initialize]);
  if (finished) return children;
  if (setup && admin && !standalone)
    return (
      <FirstCompanion
        setup={setup}
        refresh={refresh}
        onEnter={() => setFinished(true)}
        onDefer={() => {
          saveWorkspaceView({ onboardingDeferred: true });
          setFinished(true);
        }}
      />
    );
  return (
    <StartupPages
      page={error || setup ? "failure" : "preparing"}
      status="正在读取配置…"
      error={error || (setup ? "请让管理员完成首次设置，然后重试。" : "")}
      onAction={() =>
        void initialize().catch((cause) => setError(cause.message))
      }
    />
  );
}
function FirstCompanion({
  setup,
  refresh,
  onEnter,
  onDefer,
}: {
  setup: Setup;
  refresh: () => Promise<Setup>;
  onEnter: () => void;
  onDefer: () => void;
}) {
  const { profile, store } = useModelSettings(setup.botId);
  const [provider, setProvider] = useState<string>();
  const [page, setPage] = useState<"access" | "ai" | "ready">(
    setup.binding.computer?.authorized ? "ai" : "access",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(crypto.randomUUID());
  const computer = setup.binding.computer?.name ?? "这台电脑";
  const providers = (profile ?? setup.engine).providers.map((item) => {
    const connection = store.connection(
      store.snapshot().choices[item.id] ?? { provider: item.id, model: null },
    );
    return {
      id: item.id,
      name: item.name,
      status: connection
        ? connection.ready
          ? connection.authenticated
            ? "已连接"
            : "等待登录"
          : "未就绪"
        : "未检查",
    };
  });
  if (provider && page !== "ready")
    return (
      <ModelSetting
        key={provider}
        botId={setup.botId}
        connected
        setupProvider={provider}
        onboarding={{
          computer,
          bot: setup.bot,
          onBack: () => setProvider(undefined),
          onDefer,
          onReady: async () => {
            const next = await refresh();
            if (!next.ready) throw new Error("请先保存模型配置。");
            setPage("ready");
          },
        }}
      />
    );
  const engine = profile ?? setup.engine;
  return (
    <StartupPages
      page={page}
      computer={computer}
      bot={setup.bot}
      providers={providers}
      provider={providers.find((item) => item.id === engine.config.provider)}
      models={
        engine.catalog
          .find((item) => item.id === engine.config.provider)
          ?.models.map((item) => ({ value: item.id, label: item.name })) ??
        (engine.config.model === null
          ? [{ value: "", label: "原生默认模型" }]
          : [])
      }
      model={engine.config.model ?? ""}
      busy={busy}
      error={error}
      onProvider={(item) => setProvider(item.id)}
      onAction={(action) => {
        if (action === "enter") onEnter();
        if (action === "defer") onDefer();
        if (action === "back") {
          if (page === "ai") setPage("access");
          else onDefer();
        }
        if (action === "allow" && !busy) {
          setBusy(true);
          setError("");
          void authorizeComputer(setup.botId, request.current)
            .then(refresh)
            .then(() => setPage("ai"))
            .catch((cause) => setError(cause.message))
            .finally(() => setBusy(false));
        }
      }}
    />
  );
}
