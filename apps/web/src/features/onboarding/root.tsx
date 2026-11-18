import { Button } from "@domos/ui/controls";
import { StartupLoading } from "@domos/ui/startup";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { client } from "../../client.ts";
import { ModelSetup } from "../bots/details/model.tsx";
import { readModelSettings } from "../models/model-state.ts";
import type { SettingsAccess } from "../settings/sections.tsx";
import { Titlebar } from "../shell/titlebar.tsx";
import { saveWorkspaceView, workspaceView } from "../shell/workspace-state.ts";

type Setup = {
  botId: number;
  binding: Awaited<ReturnType<typeof client.computer.get>>;
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
    const bots = await client.bots.list();
    const bot = bots[0];
    if (!bot) throw new Error("未找到初始 Bot。请重新连接 Domos。");
    const [binding, engine] = await Promise.all([
      client.computer.get({ botId: bot.id }),
      readModelSettings(bot.id),
    ]);
    const next: Setup = {
      botId: bot.id,
      binding,
      ready: Boolean(
        binding.computer?.authorized &&
          (engine.revision > 0 || engine.prepared),
      ),
    };
    setSetup(next);
    return next;
  }, []);
  const initialize = useCallback(async () => {
    const next = await refresh();
    setFinished(next.ready);
  }, [refresh]);
  useEffect(() => {
    if (!finished) void initialize().catch((cause) => setError(cause.message));
  }, [finished, initialize]);
  if (finished) return children;
  const guide = setup && admin && !standalone;
  return (
    <div className="setup-window">
      <Titlebar loading={!guide} />
      {guide ? (
        <ModelSetup
          botId={setup.botId}
          onboarding={{
            binding: setup.binding,
            issue: error,
            skip: () => {
              saveWorkspaceView({ onboardingDeferred: true });
              setFinished(true);
            },
          }}
          onReady={() =>
            void refresh()
              .then((next) => {
                if (next.ready) setFinished(true);
                else setError("请先保存模型配置。");
              })
              .catch((cause) => setError(cause.message))
          }
        />
      ) : (
        <StartupLoading
          message={
            error ||
            (setup ? "请让管理员完成首次设置，然后重试。" : "正在读取配置…")
          }
          status={error ? "error" : setup ? "waiting" : "loading"}
        >
          {(error || setup) && (
            <Button
              variant="secondary"
              onClick={() =>
                void initialize().catch((cause) => setError(cause.message))
              }
            >
              重试
            </Button>
          )}
        </StartupLoading>
      )}
    </div>
  );
}
