import { Button } from "@domos/ui/controls";
import { useCallback, useEffect, useState } from "react";
import { client } from "../../client.ts";
import { AddComputer } from "./add.tsx";
import { computerLabels } from "./copy.ts";
import { ComputerDetails, ConfirmComputerAction } from "./dialogs.tsx";

export function ComputerSettings({ admin }: { admin: boolean }) {
  const [catalog, setCatalog] =
    useState<Awaited<ReturnType<typeof client.computer.list>>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(
    async () => setCatalog(await client.computer.list()),
    [],
  );
  useEffect(() => {
    void refresh().catch((cause) => setError(cause.message));
  }, [refresh]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "操作未确认。请刷新状态。",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="hosting-stack" aria-label="电脑管理" aria-busy={busy}>
      <p className="detail-note">
        普通聊天不需要电脑。多个 Bot 可共用一台电脑。共享电脑上的 Bot
        共享文件和系统权限。
      </p>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() => void run(refresh)}
      >
        刷新电脑状态
      </Button>
      {catalog?.items.map((item) => (
        <section
          className="computer-record hosting-stack"
          key={item.id}
          aria-label={item.name}
        >
          <div className="computer-heading">
            <div className="hosting-stack">
              <strong>{item.name}</strong>
              <span className="detail-note">
                {computerLabels.boundary[item.boundary]} ·{" "}
                {computerLabels.state[item.state]} ·{" "}
                {item.authorized ? "已授权" : "待授权"}
              </span>
            </div>
            <ComputerDetails name={item.name}>
              <dl className="computer-facts">
                <dt>工作根目录</dt>
                <dd>{item.directory}</dd>
                <dt>能力</dt>
                <dd>
                  {item.capabilities.commands ? "命令与文件" : "当前不可执行"}
                </dd>
                <dt>网络</dt>
                <dd>{computerLabels.network[item.network]}</dd>
              </dl>
            </ComputerDetails>
          </div>
          {item.error && <p role="alert">{item.error}</p>}
          {admin && (
            <div className="detail-actions">
              {item.authorized ? (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      client.computer.authorize({
                        id: item.id,
                        authorized: false,
                      }),
                    )
                  }
                >
                  撤销授权
                </Button>
              ) : (
                <ConfirmComputerAction
                  title={`授权使用${item.name}`}
                  description="命令和文件工具使用服务进程的系统权限。工作目录不提供安全隔离。仅在信任 Bot 的任务时授权。"
                  label="确认授权"
                  busy={busy}
                  error={error}
                  onConfirm={() =>
                    run(() =>
                      client.computer.authorize({
                        id: item.id,
                        authorized: true,
                      }),
                    )
                  }
                />
              )}
              {item.authorized && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      client.computer.default({
                        id: catalog.defaultId === item.id ? null : item.id,
                      }),
                    )
                  }
                >
                  {catalog.defaultId === item.id
                    ? "取消默认电脑"
                    : "设为新 Bot 的默认电脑"}
                </Button>
              )}
              {item.authorized && item.kind !== "process" && (
                <div className="detail-actions">
                  <Button
                    disabled={busy || item.state === "running"}
                    onClick={() =>
                      void run(() =>
                        client.computer.manage({
                          id: item.id,
                          action: "start",
                        }),
                      )
                    }
                  >
                    启动电脑
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy || item.state !== "running"}
                    onClick={() =>
                      void run(() =>
                        client.computer.manage({ id: item.id, action: "stop" }),
                      )
                    }
                  >
                    停止电脑
                  </Button>
                  <ConfirmComputerAction
                    title="重建工作容器"
                    description="工作卷保留。容器内的进程将结束。"
                    label="确认重建"
                    busy={busy}
                    error={error}
                    onConfirm={() =>
                      run(() =>
                        client.computer.manage({
                          id: item.id,
                          action: "rebuild",
                        }),
                      )
                    }
                  />
                </div>
              )}
            </div>
          )}
        </section>
      ))}
      {admin && <AddComputer onAdded={refresh} />}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
