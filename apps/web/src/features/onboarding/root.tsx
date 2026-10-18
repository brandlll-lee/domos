import { Button } from "@domos/ui/controls";
import { SetupPage } from "@domos/ui/setup";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { client } from "../../client.ts";
import { EnginePanel } from "../bots/details/engine.tsx";
import { ProfileEditor } from "../bots/details/profile.tsx";
import { type Profile, useWorkAction } from "../bots/details/use-bot-work.ts";
import { ComputerLocation } from "../computer/location.tsx";
import type { SettingsAccess } from "../settings/sections.tsx";
import { Titlebar } from "../shell/titlebar.tsx";

type Setup = {
  botId: number;
  computer: boolean;
  binding: Awaited<ReturnType<typeof client.computer.get>>;
  canIsolate: boolean;
  deployment: "native" | "container";
  profile: Profile;
  prepared: boolean;
  existing: boolean;
};

export function Onboarding({
  children,
  admin,
  standalone,
}: SettingsAccess & { children: ReactNode }) {
  const [setup, setSetup] = useState<Setup>();
  const [error, setError] = useState("");
  const [step, setStep] = useState<0 | 1 | 2>();
  const [finished, setFinished] = useState(false);
  const action = useWorkAction();
  const refresh = useCallback(async () => {
    setError("");
    const bots = await client.bots.list();
    const bot = bots[0];
    if (!bot) throw new Error("未找到初始 Bot。请重新连接 Domos。");
    const [chat, binding, location, models, profile, engine] =
      await Promise.all([
        client.get({ botId: bot.id }),
        client.computer.get({ botId: bot.id }),
        client.computer.setup(),
        client.models.list(),
        client.work.profile({ botId: bot.id }),
        client.engines.get({ botId: bot.id }),
      ]);
    const next: Setup = {
      botId: bot.id,
      computer: Boolean(binding.computer?.authorized),
      binding,
      canIsolate: location.canIsolate,
      deployment: location.deployment,
      profile,
      prepared: engine.prepared,
      existing:
        !chat.engine &&
        Boolean(
          chat.model &&
            models.some(
              (item) =>
                item.provider === chat.model?.provider &&
                item.modelId === chat.model.modelId,
            ) &&
            binding.computer?.authorized,
        ),
    };
    setSetup(next);
    return next;
  }, []);
  const initialize = useCallback(async () => {
    const next = await refresh();
    setFinished(
      next.existing ||
        (next.prepared && next.computer && next.profile.revision > 0),
    );
    setStep(next.profile.revision === 0 ? 0 : next.computer ? 2 : 1);
  }, [refresh]);
  useEffect(() => {
    void initialize().catch((cause) => setError(cause.message));
  }, [initialize]);
  if (finished) return children;
  const identity = step === 0;
  const computer = step === 1;
  const advance = (next: 1 | 2) =>
    void refresh()
      .then(() => setStep(next))
      .catch((cause) => setError(cause.message));
  return (
    <div className="setup-window">
      <Titlebar />
      <SetupPage
        label="首次设置"
        title={
          step === undefined
            ? "正在读取配置…"
            : identity
              ? "认识你的第一个 Bot"
              : computer
                ? "Bot 在哪里工作？"
                : "由谁处理任务？"
        }
        description={
          step === undefined
            ? undefined
            : identity
              ? "取个名字，告诉它要做什么。"
              : computer
                ? "选择一台工作电脑。之后也可以更换。"
                : "选择引擎并连接账号，开始第一项工作。"
        }
        progress={
          step !== undefined ? { current: step + 1, total: 3 } : undefined
        }
      >
        {setup &&
          step !== undefined &&
          (admin && !standalone ? (
            <>
              <div hidden={!identity}>
                <ProfileEditor
                  profile={setup.profile}
                  action={action}
                  onSaved={() => advance(1)}
                  submitLabel="继续"
                />
              </div>
              <div hidden={!computer}>
                <ComputerLocation
                  botId={setup.botId}
                  canIsolate={setup.canIsolate}
                  deployment={setup.deployment}
                  initialComputer={setup.binding.computer}
                  onReady={() => advance(2)}
                  onBack={() => setStep(0)}
                />
              </div>
              {step === 2 && (
                <EnginePanel
                  botId={setup.botId}
                  canManage={admin}
                  onBack={() => setStep(1)}
                  onReady={() =>
                    void refresh()
                      .then((next) => {
                        if (next.prepared) setFinished(true);
                        else setError("请先完成连接检查。");
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
        {(error || action.error) && (
          <p role="alert" className="alert">
            {error || action.error}
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
