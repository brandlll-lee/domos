import { Button } from "@domos/ui/controls";
import { Disclosure } from "@domos/ui/disclosure";
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
}: {
  computer: ReturnType<typeof useComputer>;
  botId: number;
}) {
  const { status, busy, error, setup, refresh, assign, choices, directory } =
    computer;
  const settings = useSettings();
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState("");
  const request = useRef(crypto.randomUUID());
  return (
    <section
      className="detail-page"
      aria-label="工作目录与权限"
      aria-busy={busy || preparing}
    >
      {status?.authorized ? (
        <>
          <div className="panel-card">
            <SettingRow
              title="工作目录"
              description={directory ?? "个人目录 · 自动保存文件"}
            >
              {settings.admin && (
                <ProjectDirectory botId={botId} onSaved={refresh} />
              )}
            </SettingRow>
          </div>
          <ComputerServices
            key={status.id}
            botId={botId}
            admin={settings.admin}
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
      {settings.admin && (
        <Disclosure label="高级设置">
          <div className="settings-group">
            <SettingRow
              title="执行环境"
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
              <div className="form-actions">
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
              </div>
            )}
            <div className="form-actions">
              <Button
                variant="ghost"
                size="small"
                onClick={() => settings.open("computers")}
              >
                电脑设置
              </Button>
            </div>
          </div>
        </Disclosure>
      )}
    </section>
  );
}
