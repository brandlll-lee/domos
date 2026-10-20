import { Button } from "@domos/ui/controls";
import type { Ref } from "react";
import type { EngineDialogKind } from "./engine-dialog.tsx";
import type { EngineSetup } from "./use-engine.ts";

export function EngineConnection({
  setup,
  name,
  blocked,
  onConfigure,
  actionRef,
}: {
  setup: EngineSetup;
  name: string;
  blocked: boolean;
  onConfigure: (dialog: EngineDialogKind) => void;
  actionRef?: Ref<HTMLButtonElement>;
}) {
  const { profile, connection, pending, error } = setup;
  const checking = pending === "inspect";
  const missing = connection?.ready === false;
  const pi = profile?.config.provider === "pi";
  const needsCheck = Boolean(error || (!pi && !connection));
  let label = "连接账号";
  let description = "使用已安装的程序，连接你的账号。";
  if (pi) {
    label = "连接模型";
    description = "连接模型账号，选择一个模型。";
  }
  if (missing) {
    label = `安装 ${name}`;
    description = "这台工作电脑还未安装此引擎。";
  }
  if (profile?.prepared) {
    label = pi ? "更改模型" : "账号设置";
    description = "已连接，可以开始工作。";
  }
  if (needsCheck) label = error ? "重新检查" : "检查连接";
  if (checking) {
    label = "正在检查…";
    description = "正在检查这台工作电脑。";
  }
  return (
    <div className="engine-connection">
      <div className="engine-connection-copy" role="status">
        <strong>
          {name}
          {connection?.version && (
            <span className="engine-version">{connection.version}</span>
          )}
        </strong>
        <p className="detail-note">{description}</p>
      </div>
      <Button
        ref={actionRef}
        variant="secondary"
        size="small"
        disabled={blocked}
        pending={checking}
        onClick={() => {
          if (!profile) void setup.reload();
          else if (needsCheck) void setup.inspect();
          else onConfigure(missing ? "install" : pi ? "model" : "account");
        }}
      >
        {profile ? label : error ? "重新读取" : "正在读取…"}
      </Button>
      {connection?.ready && !needsCheck && (
        <div className="engine-connection-actions">
          {!pi && connection.authenticated && (
            <Button
              variant="ghost"
              size="small"
              disabled={blocked}
              onClick={() => onConfigure("model")}
            >
              选择模型
            </Button>
          )}
          <Button
            variant="ghost"
            size="small"
            disabled={blocked}
            pending={checking}
            onClick={() => void setup.inspect()}
          >
            重新检查
          </Button>
        </div>
      )}
    </div>
  );
}
