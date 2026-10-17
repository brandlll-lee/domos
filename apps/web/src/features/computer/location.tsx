import { Button } from "@domos/ui/controls";
import { useState } from "react";
import { client } from "../../client.ts";
import "./style.css";

export function ComputerLocation({
  botId,
  canIsolate,
  onReady,
  onBusyChange,
}: {
  botId: number;
  canIsolate: boolean;
  onReady: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [host, setHost] = useState<"docker" | "process">(
    canIsolate ? "docker" : "process",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="detail-stack"
      aria-busy={busy}
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        onBusyChange?.(true);
        setError("");
        try {
          const binding = await client.computer.get({ botId });
          await client.computer.configure({
            botId,
            host,
            revision: binding.revision,
            requestId: crypto.randomUUID(),
          });
          onReady();
        } catch (cause) {
          setError(
            cause instanceof Error ? cause.message : "电脑准备未完成。请重试。",
          );
        } finally {
          setBusy(false);
          onBusyChange?.(false);
        }
      }}
    >
      <fieldset className="computer-options" aria-label="Bot 运行位置">
        <Button
          type="button"
          variant="secondary"
          className="computer-option"
          aria-pressed={host === "docker"}
          disabled={busy || !canIsolate}
          onClick={() => setHost("docker")}
        >
          <strong>隔离环境</strong>
          <span>自动创建 Docker 电脑。Bot 在容器中执行命令和处理文件。</span>
          {!canIsolate && <span>请让管理员先安装工作镜像。</span>}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="computer-option"
          aria-pressed={host === "process"}
          disabled={busy}
          onClick={() => setHost("process")}
        >
          <strong>使用本机</strong>
          <span>允许 Bot 使用 Domos 所在电脑的命令和文件。</span>
        </Button>
      </fieldset>
      <p className="detail-note">
        {host === "process"
          ? "工具将使用 Domos 服务的系统权限。仅在信任 Bot 的任务时授权。"
          : "系统会准备共享电脑。之后可为每个 Bot 切换到独立电脑。"}
      </p>
      {busy && <p role="status">正在准备电脑并绑定 Bot…</p>}
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <Button
          type="submit"
          disabled={busy || (host === "docker" && !canIsolate)}
        >
          {busy
            ? "正在准备…"
            : host === "process"
              ? "授权并继续"
              : "准备隔离电脑"}
        </Button>
      </div>
    </form>
  );
}
