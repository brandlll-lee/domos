import type { InstallProgress } from "@domos/hosting/install";
import type { Instance } from "@domos/hosting/instance";
import { Button } from "@domos/ui/controls";
import { ActionMenu, Caret } from "@domos/ui/menu";
import { type StartupPage, StartupPages } from "@domos/ui/startup";
import { initializeTheme, ThemeProvider } from "@domos/ui/theme";
import { useEffect, useEffectEvent, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/noto-sans-sc/wght.css";
import "@domos/ui/style.css";
import "./setup.css";

type Runtime = "native" | "docker";
type Input =
  | { mode: "local"; runtime: Runtime; startDocker?: boolean }
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
      submit: (input: Input) => Promise<{
        ok: boolean;
        cancelled?: boolean;
        error?: string;
        docker?: "missing" | "stopped" | "mode" | "connection";
      }>;
      cancel: () => Promise<void>;
      docker: () => Promise<void>;
      progress: (listener: (value: InstallProgress) => void) => void;
    };
  }
}
const bridge = window.domosSetup;
document.documentElement.dataset.platform = bridge.platform;

function Welcome() {
  const [page, setPage] = useState<StartupPage>("preparing");
  const [runtime, setRuntime] = useState<Runtime>("native");
  const [connections, setConnections] = useState<Instance[]>([]);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("我的 Domos");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<InstallProgress>();
  const [docker, setDocker] = useState<string>();
  const [error, setError] = useState("");
  async function submit(input: Input) {
    if (busy) return;
    setBusy(true);
    setError("");
    setDocker(undefined);
    if (input.mode === "local") setPage("preparing");
    setPhase({
      phase: "starting",
      message: input.mode === "local" ? "正在启动本机服务…" : "正在连接电脑…",
    });
    try {
      const result = await bridge.submit(input);
      if (result.cancelled) setError("准备已取消。可以重试。");
      else if (!result.ok) {
        setError(result.error ?? "连接未完成。请重试。");
        setDocker(result.docker);
      }
      if (!result.ok) setPage(input.mode === "local" ? "failure" : "remote");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "连接未完成。请重试。");
      setPage(input.mode === "local" ? "failure" : "remote");
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
        if (state.selected?.mode === "local")
          setRuntime(state.selected.runtime ?? "native");
        if (state.selected?.mode === "existing") {
          setUrl(state.selected.url);
          setName(state.selected.name);
        }
        setError(state.error);
        setPage(state.remote ? "remote" : state.error ? "failure" : "welcome");
        if (state.prepare)
          void resume({
            mode: "local",
            runtime: state.selected?.runtime ?? "native",
          });
      },
      (cause) => {
        setError(cause.message);
        setPage("failure");
      },
    );
  }, []);
  return (
    <StartupPages
      page={page}
      busy={busy}
      status={phase?.message ?? "正在读取本机配置…"}
      error={error}
      address={url}
      onAddress={(value) => {
        setUrl(value);
        setName("我的 Domos");
      }}
      onAction={(action) => {
        if (action === "start" || action === "retry")
          void submit({ mode: "local", runtime });
        if (action === "remote") {
          setPage("remote");
          setError("");
        }
        if (action === "back") {
          setPage("welcome");
          setError("");
        }
        if (action === "connect-remote")
          void submit({ mode: "existing", url, name });
      }}
      footer={
        <div className="setup-options">
          {busy ? (
            <Button variant="ghost" onClick={() => void bridge.cancel()}>
              取消准备
            </Button>
          ) : (
            <>
              {page === "welcome" && (
                <ActionMenu
                  label="高级"
                  side="top"
                  trigger={
                    <Button variant="ghost">
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
              )}
              {page === "remote" && connections.length > 0 && (
                <ActionMenu
                  label="已保存的连接"
                  side="top"
                  trigger={
                    <Button variant="ghost">
                      已保存的连接
                      <Caret />
                    </Button>
                  }
                  items={connections.map((item) => ({
                    label: item.name,
                    onSelect: () => {
                      setUrl(item.url);
                      setName(item.name);
                    },
                  }))}
                />
              )}
              {runtime === "docker" && docker === "missing" && (
                <Button
                  variant="secondary"
                  onClick={() => void bridge.docker()}
                >
                  安装 Docker Desktop
                </Button>
              )}
              {runtime === "docker" &&
                docker === "stopped" &&
                bridge.platform === "win32" && (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void submit({ mode: "local", runtime, startDocker: true })
                    }
                  >
                    启动 Docker Desktop 并继续
                  </Button>
                )}
            </>
          )}
        </div>
      }
    />
  );
}
createRoot(document.body).render(
  <ThemeProvider initialPreference={initializeTheme()}>
    <Welcome />
  </ThemeProvider>,
);
