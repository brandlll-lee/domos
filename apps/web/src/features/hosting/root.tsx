import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { SetupPage } from "@domos/ui/setup";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Onboarding } from "../onboarding/root.tsx";
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
    if (!info.ok) throw new Error("暂时无法连接 Domos。");
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
        <Onboarding
          admin={session?.device.scope === "admin" || state === "standalone"}
          deviceId={session?.device.id}
          standalone={state === "standalone"}
        >
          {children}
        </Onboarding>
      </SettingsRoot>
    );
  return (
    <div className="setup-window">
      <Titlebar />
      <SetupPage
        title={state === "pair" ? "连接这个 Domos" : "正在连接 Domos…"}
        description={
          state === "pair"
            ? "输入管理员提供的配对码，继续使用 Bot。"
            : undefined
        }
      >
        {state === "loading" && (
          <p role="status" className="detail-note">
            正在读取连接信息…
          </p>
        )}
        {state === "pair" && (
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
              <Button type="submit" pending={busy}>
                {busy ? "正在连接…" : "连接"}
              </Button>
            </div>
          </form>
        )}
        {state === "loading" && error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
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
      </SetupPage>
    </div>
  );
}
