import { Brand } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { client } from "../../client.ts";
import { EnginePanel } from "../bots/details/engine.tsx";
import { ProfileEditor } from "../bots/details/profile.tsx";
import { type Profile, useWorkAction } from "../bots/details/use-bot-work.ts";
import { ComputerLocation } from "../computer/location.tsx";
import type { SettingsAccess } from "../settings/sections.tsx";
import { Titlebar } from "../shell/titlebar.tsx";
import "./style.css";

type Setup = {
  botId: number;
  computer: boolean;
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
    setSetup({
      botId: bot.id,
      computer: Boolean(binding.computer?.authorized),
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
    });
  }, []);
  useEffect(() => {
    void refresh().catch((cause) => setError(cause.message));
  }, [refresh]);
  if (
    setup &&
    (setup.existing ||
      (setup.prepared && setup.computer && setup.profile.revision > 0))
  )
    return children;
  const identity = setup?.profile.revision === 0;
  const computer = !identity && !setup?.computer;
  const reload = () => void refresh().catch((cause) => setError(cause.message));
  return (
    <>
      <Titlebar />
      <main className="onboarding" aria-label="首次设置">
        <div className="onboarding-content">
          <Brand />
          <header>
            <p className="detail-note">
              {identity
                ? "第 1 步，共 3 步"
                : computer
                  ? "第 2 步，共 3 步"
                  : "第 3 步，共 3 步"}
            </p>
            <h1>
              {identity
                ? "认识你的第一个 Bot"
                : computer
                  ? "Bot 在哪里工作？"
                  : "由谁处理任务？"}
            </h1>
            <p className="detail-note">
              {identity
                ? "取个名字，告诉它要做什么。"
                : computer
                  ? "选择一台工作电脑。之后也可以更换。"
                  : "选择引擎并连接账号，开始第一项工作。"}
            </p>
          </header>
          {setup &&
            (admin && !standalone ? (
              identity ? (
                <ProfileEditor
                  profile={setup.profile}
                  action={action}
                  onSaved={reload}
                  submitLabel="继续"
                />
              ) : computer ? (
                <ComputerLocation
                  botId={setup.botId}
                  canIsolate={setup.canIsolate}
                  deployment={setup.deployment}
                  onReady={() =>
                    void refresh().catch((cause) => setError(cause.message))
                  }
                />
              ) : (
                <EnginePanel
                  botId={setup.botId}
                  canManage={admin}
                  onReady={reload}
                />
              )
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
                void refresh().catch((cause) => setError(cause.message))
              }
            >
              重试
            </Button>
          )}
        </div>
      </main>
    </>
  );
}
