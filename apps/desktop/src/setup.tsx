import type { InstallProgress } from "@domos/hosting/install";
import type { Instance } from "@domos/hosting/instance";
import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { ActionMenu, Caret } from "@domos/ui/menu";
import { StartupLoading, StartupScene } from "@domos/ui/startup";
import { useEffect, useEffectEvent, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/noto-sans-sc/wght.css";
import "../../../packages/ui/src/web/controls.css";
import "../../../packages/ui/src/web/avatar.css";
import "../../../packages/ui/src/web/setup.css";
import "./setup.css";

type Runtime = "native" | "docker";
type Input =
  | { mode: "local"; runtime: Runtime }
  | { mode: "existing"; url: string; name: string };
declare global {
  interface Window {
    domosSetup: {
      platform: string;
      state: () => Promise<{
        instances: Instance[];
        selected?: Instance;
        error: string;
        prepare: boolean;
        remote: boolean;
      }>;
      submit: (
        input: Input,
      ) => Promise<{ ok: boolean; cancelled?: boolean; error?: string }>;
      cancel: () => Promise<void>;
      docker: () => Promise<void>;
      progress: (listener: (value: InstallProgress) => void) => void;
    };
  }
}
const bridge = window.domosSetup;
document.documentElement.dataset.platform = bridge.platform;

function Welcome() {
  const [loaded, setLoaded] = useState(false);
  const [remote, setRemote] = useState(false);
  const [runtime, setRuntime] = useState<Runtime>("native");
  const [connections, setConnections] = useState<Instance[]>([]);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("我的 Domos");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<InstallProgress>();
  const [error, setError] = useState("");
  async function submit(input: Input) {
    if (busy) return;
    setBusy(true);
    setError("");
    setPhase({
      phase: "starting",
      message: input.mode === "local" ? "正在启动 Domos…" : "正在连接 Domos…",
    });
    try {
      const result = await bridge.submit(input);
      if (result.cancelled) setError("准备已取消。可以重试。");
      else if (!result.ok) setError(result.error ?? "连接未完成。请重试。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "连接未完成。请重试。");
    } finally {
      setBusy(false);
    }
  }
  const resume = useEffectEvent(submit);
  useEffect(() => {
    bridge.progress(setPhase);
    void bridge.state().then(
      (state) => {
        setConnections(
          state.instances.filter((item) => item.mode === "existing"),
        );
        setRemote(state.remote);
        if (state.selected?.mode === "local")
          setRuntime(state.selected.runtime ?? "native");
        if (state.selected?.mode === "existing") {
          setUrl(state.selected.url);
          setName(state.selected.name);
        }
        setError(state.error);
        setLoaded(true);
        if (state.prepare)
          void resume({
            mode: "local",
            runtime: state.selected?.runtime ?? "native",
          });
      },
      (cause) => {
        setLoaded(true);
        setError(cause.message);
      },
    );
  }, []);
  const cancel = (
    <Button
      variant="secondary"
      className="startup-form-cancel"
      onClick={() => void bridge.cancel()}
    >
      取消准备
    </Button>
  );
  return (
    <div className="setup-window">
      <header className="titlebar" />
      {!loaded || (busy && !remote) ? (
        <StartupLoading message={phase?.message ?? "正在准备本机…"}>
          {busy && cancel}
        </StartupLoading>
      ) : (
        <StartupScene
          stop={remote ? "address" : "home"}
          title={remote ? "连接另一台电脑" : "你的 Bot 在哪台电脑？"}
          description={
            remote
              ? "用地址找到存放 Bot 的那台电脑。"
              : "在本机创建，或连接另一台电脑。"
          }
          back={
            remote && !busy
              ? () => {
                  setRemote(false);
                  setError("");
                }
              : undefined
          }
          footer={
            !remote && (
              <ActionMenu
                label="高级"
                side="top"
                trigger={
                  <Button
                    variant="ghost"
                    className="setup-advanced"
                    aria-label="高级"
                    title={
                      runtime === "docker"
                        ? "需要安装并启动 Docker。首次会下载运行包。"
                        : undefined
                    }
                  >
                    {runtime === "docker" ? "高级 · Docker" : "高级"}
                    <Caret />
                  </Button>
                }
                items={[
                  { label: "直接运行", onSelect: () => setRuntime("native") },
                  {
                    label: "在 Docker 中运行",
                    onSelect: () => setRuntime("docker"),
                  },
                ]}
              />
            )
          }
        >
          {remote ? (
            <form
              id="remote-connection"
              className="setup-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submit({ mode: "existing", url, name });
              }}
            >
              {connections.length > 0 && (
                <section
                  className="saved-connections"
                  aria-label="已保存的连接"
                >
                  {connections.map((connection) => (
                    <Button
                      key={connection.id}
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setUrl(connection.url);
                        setName(connection.name);
                      }}
                    >
                      {connection.name}
                    </Button>
                  ))}
                </section>
              )}
              <TextField
                label="连接名称"
                value={name}
                onValueChange={setName}
                disabled={busy}
                required
                maxLength={80}
              />
              <TextField
                label="Domos 地址"
                value={url}
                onValueChange={setUrl}
                disabled={busy}
                type="url"
                placeholder="https://domos.example.com"
                required
              />
              <div className="startup-branches">
                <Button
                  type="submit"
                  variant="ghost"
                  className="startup-branch"
                  pending={busy}
                >
                  {busy ? "正在连接…" : "连接"}
                  <span className="startup-arrow" aria-hidden="true">
                    →
                  </span>
                </Button>
              </div>
              {busy && cancel}
            </form>
          ) : (
            <div className="startup-branches">
              <Button
                variant="ghost"
                className="startup-branch"
                aria-label={error ? "重试" : "在本机开始"}
                onClick={() => void submit({ mode: "local", runtime })}
              >
                <span className="startup-branch-copy">
                  <strong>{error ? "重试" : "在本机开始"}</strong>
                  <small>设置这台电脑上的 Domos</small>
                </span>
                <span className="startup-arrow" aria-hidden="true">
                  ↗
                </span>
              </Button>
              <Button
                variant="ghost"
                className="startup-branch"
                aria-label="连接另一台电脑"
                onClick={() => {
                  setRemote(true);
                  setError("");
                }}
              >
                <span className="startup-branch-copy">
                  <strong>连接已有 Domos</strong>
                  <small>打开另一台电脑上的 Bot</small>
                </span>
                <span className="startup-arrow" aria-hidden="true">
                  ↘
                </span>
              </Button>
            </div>
          )}
          {error && (
            <p className="alert startup-error" role="alert">
              {error}
            </p>
          )}
          {error && runtime === "docker" && phase?.phase === "checking" && (
            <Button
              variant="ghost"
              className="startup-extra"
              onClick={() => void bridge.docker()}
            >
              安装或启动 Docker Desktop
            </Button>
          )}
        </StartupScene>
      )}
    </div>
  );
}
createRoot(document.body).render(<Welcome />);
