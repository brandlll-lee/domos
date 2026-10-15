import { Button } from "@domos/ui/controls";
import { computerLabels } from "./copy.ts";
import type { useComputer } from "./use-computer.ts";

export function ComputerPanel({
  computer,
}: {
  computer: ReturnType<typeof useComputer>;
}) {
  const { status, busy, error, run } = computer;
  return (
    <section className="detail-stack" aria-label="工作电脑" aria-busy={busy}>
      {status ? (
        <>
          <h3>{computerLabels.boundary[status.boundary]}</h3>
          <p className="detail-note">
            {computerLabels.state[status.state]} · {status.id}
          </p>
          <dl className="computer-facts">
            <dt>系统</dt>
            <dd>
              {status.os ? `${status.os} ${status.arch ?? ""}` : "连接后确认"}
            </dd>
            <dt>工作根目录</dt>
            <dd>{status.directory}</dd>
            <dt>网络</dt>
            <dd>{computerLabels.network[status.network]}</dd>
            <dt>服务部署</dt>
            <dd>
              {status.deployment === "container" ? "应用容器" : "原生进程"}
            </dd>
          </dl>
          <p className="detail-note">
            {status.boundary === "sandbox"
              ? "命令和工作文件在独立容器内执行。共享这台电脑的 Bot 共享文件和权限。停止或重建容器会中断全部 Bot 的进程，工作卷保留。"
              : "工具使用服务进程的系统权限。工作目录不是安全隔离边界。"}
          </p>
          {status.error && (
            <p className="alert" role="alert">
              {status.error}
            </p>
          )}
        </>
      ) : (
        <p className="detail-note" role="status">
          正在读取工作电脑…
        </p>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <div className="detail-actions">
        <Button variant="secondary" disabled={busy} onClick={() => void run()}>
          刷新状态
        </Button>
        {status?.kind === "docker" && (
          <>
            <Button
              disabled={busy || status.state === "running"}
              onClick={() => void run("start")}
            >
              启动电脑
            </Button>
            <Button
              variant="secondary"
              disabled={busy || status.state !== "running"}
              onClick={() => void run("stop")}
            >
              停止电脑
            </Button>
            <details>
              <summary>重建工作容器</summary>
              <p className="detail-note">
                保留工作卷。容器内未保存的进程将结束。
              </p>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void run("rebuild")}
              >
                确认重建
              </Button>
            </details>
          </>
        )}
      </div>
    </section>
  );
}
