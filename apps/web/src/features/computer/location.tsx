import { Button } from "@domos/ui/controls";
import { useEffect, useRef, useState } from "react";
import { client } from "../../client.ts";
import "./style.css";

export function ComputerLocation({
  botId,
  canIsolate,
  deployment,
  onReady,
  onBusyChange,
}: {
  botId: number;
  canIsolate: boolean;
  deployment: "native" | "container";
  onReady: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [mode, setMode] = useState<"process" | "shared" | "dedicated">(
    "process",
  );
  const [local, setLocal] = useState(false);
  const request = useRef(crypto.randomUUID());
  const active = useRef(false);
  useEffect(() => {
    void window.domosDesktop
      ?.state()
      .then((result) => setLocal(result.value?.mode === "local"));
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="detail-stack"
      aria-busy={busy}
      onSubmit={async (event) => {
        event.preventDefault();
        if (active.current) return;
        active.current = true;
        setBusy(true);
        onBusyChange?.(true);
        setError("");
        try {
          if (mode !== "process" && local) {
            const result = await window.domosDesktop?.prepare();
            if (result && !result.ok) throw new Error(result.error);
          }
          const binding = await client.computer.get({ botId });
          const input = {
            botId,
            revision: binding.revision,
            requestId: request.current,
          };
          if (mode === "process") {
            const directory = await client.computer.list();
            const process = directory.items.find(
              (item) => item.kind === "process" && item.authorized,
            );
            if (process)
              await client.computer.assign({
                ...input,
                computerId: process.id,
              });
            else await client.computer.configure({ ...input, mode });
          } else await client.computer.prepare({ ...input, mode });
          onReady();
        } catch (cause) {
          setError(
            cause instanceof Error ? cause.message : "电脑准备未完成。请重试。",
          );
        } finally {
          active.current = false;
          setBusy(false);
          onBusyChange?.(false);
        }
      }}
    >
      <fieldset className="computer-options" aria-label="此 Bot 的工作环境">
        <Button
          type="button"
          variant="secondary"
          className="computer-option"
          aria-pressed={mode === "process"}
          disabled={busy}
          onClick={() => {
            setMode("process");
            request.current = crypto.randomUUID();
          }}
        >
          <strong>
            {deployment === "container"
              ? "使用服务容器"
              : local
                ? "使用这台电脑"
                : "使用服务所在电脑"}
          </strong>
          <span>使用 Domos 所在环境的文件和命令。</span>
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="computer-option"
          aria-pressed={mode === "shared"}
          disabled={busy || !canIsolate}
          onClick={() => {
            setMode("shared");
            request.current = crypto.randomUUID();
          }}
        >
          <strong>共用一台隔离电脑</strong>
          <span>与其他 Bot 共用文件。需要 Docker。</span>
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="computer-option"
          aria-pressed={mode === "dedicated"}
          disabled={busy || !canIsolate}
          onClick={() => {
            setMode("dedicated");
            request.current = crypto.randomUUID();
          }}
        >
          <strong>单独一台隔离电脑</strong>
          <span>仅供此 Bot 使用。需要 Docker。</span>
        </Button>
      </fieldset>
      <p className="detail-note">
        {mode === "process"
          ? "确认后，允许 Bot 使用此环境的文件和系统权限。"
          : "确认后才会下载并准备。聊天记录仍保存在 Domos 中。"}
        {!canIsolate && " 此服务尚未提供隔离电脑。"}
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
          disabled={busy || (mode !== "process" && !canIsolate)}
        >
          {busy
            ? "正在准备…"
            : mode === "process"
              ? "授权并继续"
              : "准备隔离电脑"}
        </Button>
      </div>
    </form>
  );
}
