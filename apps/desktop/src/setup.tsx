import type { InstallProgress } from "@domos/hosting/install";
import type { Instance } from "@domos/hosting/instance";
import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { ActionMenu, Caret } from "@domos/ui/menu";
import { CharacterTeam, SetupPage, SetupStatus } from "@domos/ui/setup";
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
  return (
    <div className="setup-window">
      <header className="titlebar" />
      <SetupPage
        title={
          !loaded || busy ? "" : remote ? "连接另一台电脑" : "认识一下 Domos"
        }
        corner={
          loaded &&
          !busy &&
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
        footer={
          busy ? (
            <Button variant="secondary" onClick={() => void bridge.cancel()}>
              取消准备
            </Button>
          ) : loaded ? (
            <>
              <Button
                type={remote ? "submit" : "button"}
                form={remote ? "remote-connection" : undefined}
                onClick={
                  remote
                    ? undefined
                    : () => void submit({ mode: "local", runtime })
                }
              >
                {remote ? "连接" : error ? "重试" : "开始使用"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setRemote(!remote);
                  setError("");
                }}
              >
                {remote ? "返回" : "连接另一台电脑"}
              </Button>
            </>
          ) : undefined
        }
      >
        {!loaded || busy ? (
          <SetupStatus>
            {phase?.message ?? "正在启动 Domos…"}
            {busy && (
              <progress className="setup-progress" aria-label="准备进度" />
            )}
          </SetupStatus>
        ) : remote ? (
          <form
            id="remote-connection"
            className="setup-form setup-remote"
            onSubmit={(event) => {
              event.preventDefault();
              void submit({ mode: "existing", url, name });
            }}
          >
            {connections.length > 0 && (
              <section className="saved-connections" aria-label="已保存的连接">
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
              required
              maxLength={80}
            />
            <TextField
              label="Domos 地址"
              value={url}
              onValueChange={setUrl}
              type="url"
              placeholder="https://domos.example.com"
              required
            />
          </form>
        ) : (
          <div className="setup-welcome">
            <CharacterTeam />
            <div>
              <h2>你的 AI 队友，在电脑上工作，随时与你连接。</h2>
              <p>
                运行在你的电脑或云服务器上。用手机或电脑与它交流，Domos Bot
                像你一样工作。
              </p>
            </div>
          </div>
        )}
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        {error && runtime === "docker" && phase?.phase === "checking" && (
          <Button variant="ghost" onClick={() => void bridge.docker()}>
            安装或启动 Docker Desktop
          </Button>
        )}
      </SetupPage>
    </div>
  );
}
createRoot(document.body).render(<Welcome />);
