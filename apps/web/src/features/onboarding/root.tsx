import { Button } from "@domos/ui/controls";
import { SetupPage } from "@domos/ui/setup";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { client } from "../../client.ts";
import { ModelSetup } from "../bots/details/model.tsx";
import { ComputerLocation } from "../computer/location.tsx";
import type { SettingsAccess } from "../settings/sections.tsx";
import { Titlebar } from "../shell/titlebar.tsx";

type Setup = {
  botId: number;
  computer: boolean;
  binding: Awaited<ReturnType<typeof client.computer.get>>;
  canIsolate: boolean;
  deployment: "native" | "container";
  configured: boolean;
};

export function Onboarding({
  children,
  admin,
  standalone,
}: SettingsAccess & { children: ReactNode }) {
  const [setup, setSetup] = useState<Setup>();
  const [error, setError] = useState("");
  const [step, setStep] = useState<0 | 1>();
  const [finished, setFinished] = useState(false);
  const refresh = useCallback(async () => {
    setError("");
    const bots = await client.bots.list();
    const bot = bots[0];
    if (!bot) throw new Error("未找到初始 Bot。请重新连接 Domos。");
    const [binding, location, engine] = await Promise.all([
      client.computer.get({ botId: bot.id }),
      client.computer.setup(),
      client.engines.get({ botId: bot.id }),
    ]);
    const next: Setup = {
      botId: bot.id,
      computer: Boolean(binding.computer?.authorized),
      binding,
      canIsolate: location.canIsolate,
      deployment: location.deployment,
      configured: engine.revision > 0 || engine.prepared,
    };
    setSetup(next);
    return next;
  }, []);
  const initialize = useCallback(async () => {
    const next = await refresh();
    setFinished(next.configured && next.computer);
    setStep(next.computer ? 1 : 0);
  }, [refresh]);
  useEffect(() => {
    void initialize().catch((cause) => setError(cause.message));
  }, [initialize]);
  if (finished) return children;
  const computer = step === 0;
  const advance = () =>
    void refresh()
      .then((next) => {
        if (next.configured && next.computer) setFinished(true);
        else setStep(1);
      })
      .catch((cause) => setError(cause.message));
  return (
    <div className="setup-window">
      <Titlebar />
      <SetupPage
        label="首次设置"
        title={
          step === undefined
            ? "正在读取配置…"
            : computer
              ? "Bot 在哪里工作？"
              : "选择对话模型"
        }
        description={
          step === undefined
            ? undefined
            : computer
              ? "选择一台工作电脑。之后也可以更换。"
              : "连接模型账号，开始第一项工作。"
        }
        progress={
          step !== undefined ? { current: step + 1, total: 2 } : undefined
        }
      >
        {setup &&
          step !== undefined &&
          (admin && !standalone ? (
            <>
              <div hidden={!computer}>
                <ComputerLocation
                  botId={setup.botId}
                  canIsolate={setup.canIsolate}
                  deployment={setup.deployment}
                  initialComputer={setup.binding.computer}
                  onReady={advance}
                />
              </div>
              {step === 1 && (
                <ModelSetup
                  botId={setup.botId}
                  onBack={() => setStep(0)}
                  onReady={() =>
                    void refresh()
                      .then((next) => {
                        if (next.configured && next.computer) setFinished(true);
                        else setError("请先保存模型配置。");
                      })
                      .catch((cause) => setError(cause.message))
                  }
                />
              )}
            </>
          ) : (
            <p role="status">请让管理员完成首次设置，然后重试。</p>
          ))}
        {!setup && !error && <p role="status">正在读取配置…</p>}
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
