import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { StartupLoading, StartupScene } from "@domos/ui/startup";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { client, selectComputer } from "../../client.ts";
import { ApplicationNotices } from "../notices.tsx";
import { Onboarding } from "../onboarding/root.tsx";
import { SettingsRoot } from "../settings/root.tsx";
import { Titlebar } from "../shell/titlebar.tsx";
import { hostingRequest } from "./api.ts";
import "./style.css";

type Session = { device: { id: string; scope: string } };

export function HostingRoot({ children }: { children: ReactNode }) {
  const [state, setState] = useState<
    "loading" | "pair" | "ready" | "standalone" | "suspended"
  >("loading");
  const [computerId, setComputerId] = useState("");
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("我的设备");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const info = await fetch("/hosting/info");
    if (info.status === 404) {
      const node = await client.computer.node();
      selectComputer(node.id);
      setComputerId(node.id);
      setState("standalone");
      return;
    }
    if (!info.ok) throw new Error("暂时无法连接 Domos。");
    const response = await fetch("/hosting/session");
    if (response.status === 401) {
      setState("pair");
      window.domosDesktop?.pairing();
      return;
    }
    if (!response.ok) throw new Error("无法读取设备状态。");
    const value: Session = await response.json();
    const node = await client.computer.node();
    selectComputer(node.id);
    setComputerId(node.id);
    setSession(value);
    await window.domosDesktop?.connected();
    setState("ready");
  }, []);
  useEffect(() => {
    void refresh().catch((error) => setError(error.message));
    const unauthorized = () => {
      setSession(undefined);
      setState("pair");
    };
    window.addEventListener("domos:pair", unauthorized);
    const leave = () => flushSync(() => setState("suspended"));
    window.addEventListener("domos:workspace-leave", leave);
    return () => {
      window.removeEventListener("domos:pair", unauthorized);
      window.removeEventListener("domos:workspace-leave", leave);
    };
  }, [refresh]);
  if (state === "suspended") return null;
  if (state === "ready" || state === "standalone")
    return (
      <SettingsRoot
        key={computerId}
        admin={session?.device.scope === "admin" || state === "standalone"}
        deviceId={session?.device.id}
        standalone={state === "standalone"}
      >
        <ApplicationNotices>
          <Onboarding
            admin={session?.device.scope === "admin" || state === "standalone"}
            deviceId={session?.device.id}
            standalone={state === "standalone"}
          >
            {children}
          </Onboarding>
        </ApplicationNotices>
      </SettingsRoot>
    );
  return (
    <div className="setup-window">
      <Titlebar loading={state === "loading"} />
      {state === "pair" ? (
        <StartupScene
          stop="pair"
          title="连接这个 Domos"
          description="配对码让另一台电脑认出你的设备。"
        >
          <form
            className="setup-form"
            aria-busy={busy}
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              setBusy(true);
              setError("");
              try {
                await hostingRequest("exchange", { code, label });
                setCode("");
                await refresh();
              } catch (error) {
                setError((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <TextField
              label="设备名称"
              value={label}
              maxLength={80}
              onValueChange={setLabel}
              required
              disabled={busy}
            />
            <TextField
              label="配对码"
              value={code}
              autoComplete="off"
              onValueChange={setCode}
              required
              disabled={busy}
            />
            {error && (
              <p className="alert" role="alert">
                {error}
              </p>
            )}
            <div className="setup-actions">
              {window.domosDesktop && (
                <Button
                  variant="secondary"
                  className="startup-form-cancel"
                  onClick={() => window.domosDesktop?.cancelConnection()}
                >
                  取消
                </Button>
              )}
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
          </form>
        </StartupScene>
      ) : (
        <StartupLoading
          message={error || "正在读取连接信息…"}
          status={error ? "error" : "loading"}
        >
          {error && (
            <Button
              variant="secondary"
              onClick={() => {
                setError("");
                void refresh().catch((error) => setError(error.message));
              }}
            >
              重试
            </Button>
          )}
        </StartupLoading>
      )}
    </div>
  );
}
