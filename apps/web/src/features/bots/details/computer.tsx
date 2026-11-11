import { Button } from "@domos/ui/controls";
import { Disclosure } from "@domos/ui/disclosure";
import { PanelGroup } from "@domos/ui/panel";
import { ChoicePicker } from "@domos/ui/picker";
import { SettingRow } from "@domos/ui/setting-row";
import { useRef, useState } from "react";
import { client } from "../../../client.ts";
import { ProjectDirectory } from "../../computer/directory.tsx";
import { ComputerPermission } from "../../computer/permission.tsx";
import { ComputerServices } from "../../computer/services.tsx";
import type { useComputer } from "../../computer/use-computer.ts";
import { useSettings } from "../../settings/context.ts";

export function ComputerSettings({
  computer,
  botId,
  configuring,
  onConfigure,
}: {
  computer: ReturnType<typeof useComputer>;
  botId: number;
  configuring: boolean;
  onConfigure: () => void;
}) {
  const { status, busy, error, setup, refresh, assign, choices, directory } =
    computer;
  const settings = useSettings();
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState("");
  const request = useRef(crypto.randomUUID());
  return (
    <section
      className="panel-page"
      aria-label={configuring ? "Jev 辅助操作" : "工作目录与权限"}
      aria-busy={busy || preparing}
    >
      {status?.authorized ? (
        <>
          {!configuring && (
            <PanelGroup title="工作目录">
              <SettingRow
                title={directory ? "项目目录" : "个人目录"}
                description={directory ?? "文件自动保存在此目录。"}
              >
                {settings.admin && (
                  <ProjectDirectory botId={botId} onSaved={refresh} />
                )}
              </SettingRow>
            </PanelGroup>
          )}
          <ComputerServices
            key={status.id}
            botId={botId}
            admin={settings.admin}
            configuring={configuring}
            onConfigure={onConfigure}
          />
        </>
      ) : settings.admin ? (
        <ComputerPermission botId={botId} onReady={refresh} />
      ) : (
        <p>请让管理员授权文件与命令访问。</p>
      )}
      {status?.error && (
        <p className="alert" role="alert">
          {status.error}
        </p>
      )}
      {(error || prepareError) && (
        <p className="alert" role="alert">
          {error || prepareError}
        </p>
      )}
      {settings.admin && !configuring && (
        <PanelGroup title="执行环境">
          <Disclosure label={status?.name ?? "选择环境"}>
            <SettingRow
              title="运行位置"
              description="更换环境不会搬迁文件或登录状态。"
            >
              <ChoicePicker
                label="执行环境"
                value={status?.id ?? ""}
                disabled={busy || preparing || status?.busy}
                onValueChange={(id) => void assign(id)}
                items={choices
                  .filter(
                    (item) =>
                      (item.local && item.authorized) || item.id === status?.id,
                  )
                  .map((item) => ({ value: item.id, label: item.name }))}
              />
            </SettingRow>
            {setup?.canIsolate && (
              <SettingRow title="隔离容器" description="准备独立的工作环境。">
                <Button
                  variant="secondary"
                  size="small"
                  pending={preparing}
                  disabled={busy || status?.busy}
                  onClick={async () => {
                    if (preparing) return;
                    setPreparing(true);
                    setPrepareError("");
                    try {
                      const binding = await client.computer.get({ botId });
                      await client.computer.prepare({
                        botId,
                        mode: "dedicated",
                        revision: binding.revision,
                        requestId: request.current,
                      });
                      request.current = crypto.randomUUID();
                      await refresh();
                    } catch (cause) {
                      setPrepareError(
                        cause instanceof Error
                          ? cause.message
                          : "容器准备未确认。请重试。",
                      );
                    } finally {
                      setPreparing(false);
                    }
                  }}
                >
                  准备隔离容器
                </Button>
              </SettingRow>
            )}
            <SettingRow title="电脑设置" description="管理此电脑的授权和环境。">
              <Button
                variant="ghost"
                size="small"
                onClick={() => settings.open("computers")}
              >
                电脑设置
              </Button>
            </SettingRow>
          </Disclosure>
        </PanelGroup>
      )}
    </section>
  );
}
