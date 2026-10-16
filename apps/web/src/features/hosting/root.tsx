import { Brand } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { SettingsRoot } from "../settings/root.tsx";
import { Titlebar } from "../shell/titlebar.tsx";
import { hostingRequest } from "./api.ts";
import "./style.css";

type Session = { device: { id: string; scope: string } };

export function HostingRoot({ children }: { children: ReactNode }) {
  const [state, setState] = useState<
    "loading" | "pair" | "ready" | "standalone"
  >("loading");
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("我的设备");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const info = await fetch("/hosting/info");
    if (info.status === 404) {
      setState("standalone");
      return;
    }
    if (!info.ok) throw new Error("实例暂时不可用。");
    const response = await fetch("/hosting/session");
    if (response.status === 401) {
      setState("pair");
      return;
    }
    if (!response.ok) throw new Error("无法读取设备状态。");
    const value: Session = await response.json();
    setSession(value);
    setState("ready");
  }, []);
  useEffect(() => {
    void refresh().catch((error) => setError(error.message));
    const unauthorized = () => {
      setSession(undefined);
      setState("pair");
    };
    window.addEventListener("domos:pair", unauthorized);
    return () => window.removeEventListener("domos:pair", unauthorized);
  }, [refresh]);
  if (state === "ready" || state === "standalone")
    return (
      <SettingsRoot
        admin={session?.device.scope === "admin" || state === "standalone"}
        deviceId={session?.device.id}
        standalone={state === "standalone"}
      >
        {children}
      </SettingsRoot>
    );
  return (
    <>
      <Titlebar />
      <main className="hosting-welcome">
        <div className="hosting-card">
          <Brand />
          {state === "loading" && <p role="status">正在连接实例…</p>}
          {state === "pair" && (
            <form
              className="hosting-stack"
              onSubmit={async (event) => {
                event.preventDefault();
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
              <h1>连接这个 Domos</h1>
              <p className="detail-note">
                输入管理员提供的配对码。首次托管请使用安装器提供的管理员码。
              </p>
              <label>
                设备名称
                <input
                  className="field-control"
                  value={label}
                  maxLength={80}
                  onChange={(event) => setLabel(event.target.value)}
                  required
                />
              </label>
              <label>
                配对码
                <input
                  className="field-control"
                  value={code}
                  autoComplete="off"
                  onChange={(event) => setCode(event.target.value)}
                  required
                />
              </label>
              <Button type="submit" disabled={busy}>
                连接
              </Button>
            </form>
          )}
          {error && <p role="alert">{error}</p>}
          {state === "loading" && error && (
            <Button
              variant="secondary"
              onClick={() =>
                void refresh().catch((error) => setError(error.message))
              }
            >
              重试
            </Button>
          )}
        </div>
      </main>
    </>
  );
}
