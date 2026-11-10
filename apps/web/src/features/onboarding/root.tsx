import { Button } from "@domos/ui/controls";
import { SetupPage, SetupStatus } from "@domos/ui/setup";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { client } from "../../client.ts";
import { ModelSetup } from "../bots/details/model.tsx";
import { readModelSettings } from "../models/model-state.ts";
import type { SettingsAccess } from "../settings/sections.tsx";
import { Titlebar } from "../shell/titlebar.tsx";

type Setup = { botId: number; computer: boolean; configured: boolean };

export function Onboarding({
  children,
  admin,
  standalone,
}: SettingsAccess & { children: ReactNode }) {
  const [setup, setSetup] = useState<Setup>();
  const [error, setError] = useState("");
  const [finished, setFinished] = useState(false);
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
      computer: Boolean(binding.computer?.authorized),
      configured: engine.revision > 0 || engine.prepared,
    };
    setSetup(next);
    return next;
  }, []);
  const initialize = useCallback(async () => {
    const next = await refresh();
    setFinished(next.configured && next.computer);
  }, [refresh]);
  useEffect(() => {
    void initialize().catch((cause) => setError(cause.message));
  }, [initialize]);
  if (finished) return children;
  return (
    <div className="setup-window">
      <Titlebar />
      <SetupPage title={setup ? "连接你的 AI" : "正在启动 Domos…"}>
        {setup &&
          (admin && !standalone ? (
            <ModelSetup
              botId={setup.botId}
              onReady={() =>
                void refresh()
                  .then((next) => {
                    if (next.configured && next.computer) setFinished(true);
                    else setError("请先保存模型配置。");
                  })
                  .catch((cause) => setError(cause.message))
              }
            />
          ) : (
            <p role="status">请让管理员完成首次设置，然后重试。</p>
          ))}
        {!setup && !error && <SetupStatus>正在读取配置…</SetupStatus>}
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}
        {(error || (setup && (!admin || standalone))) && (
          <Button
            variant="secondary"
            onClick={() =>
              void initialize().catch((cause) => setError(cause.message))
            }
          >
            重试
          </Button>
        )}
      </SetupPage>
    </div>
  );
}
