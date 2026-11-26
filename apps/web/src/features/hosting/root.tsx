import { StartupPages } from "@domos/ui/startup";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { client, selectComputer } from "../../client.ts";
import { ApplicationNotices } from "../notices.tsx";
import { Onboarding } from "../onboarding/root.tsx";
import { SettingsRoot } from "../settings/root.tsx";
import { useWindowAppearance } from "../shell/titlebar.tsx";
import { hostingRequest } from "./api.ts";
import "./style.css";

type Session = { device: { id: string; scope: string } };

export function HostingRoot({
  children,
  pairingCode,
  pairingError,
}: {
  children: ReactNode;
  pairingCode?: string;
  pairingError?: string;
}) {
  const [state, setState] = useState<
    "loading" | "pair" | "ready" | "standalone" | "suspended"
  >("loading");
  const [computerId, setComputerId] = useState("");
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState(pairingError ?? "");
  const [code, setCode] = useState(pairingCode ?? "");
  const [identity, setIdentity] = useState("");
  const [busy, setBusy] = useState(false);
  useWindowAppearance();
  const refresh = useCallback(async () => {
    const response = await fetch("/hosting/session");
    if (response.status === 404) {
      const node = await client.computer.node();
      selectComputer(node.id);
      setComputerId(node.id);
      setState("standalone");
      return;
    }
    if (response.status === 401) {
      const info = await hostingRequest<{ computerId?: string }>("info");
      setIdentity(info.computerId ?? "");
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
    <StartupPages
      page={state === "pair" ? "pair" : error ? "failure" : "preparing"}
      computer={identity || "待确认"}
      address={location.origin}
      pairingCode={code}
      onPairingCode={setCode}
      status="正在读取连接信息…"
      error={error}
      busy={busy}
      onAction={(action) => {
        if (action === "back") {
          if (window.domosDesktop) window.domosDesktop.cancelConnection();
          else history.back();
          return;
        }
        if (action === "retry") {
          setError("");
          void refresh().catch((cause) => setError(cause.message));
        }
        if (action === "pair" && !busy) {
          setBusy(true);
          setError("");
          void hostingRequest("exchange", { code, label: "我的设备" })
            .then(async () => {
              setCode("");
              await refresh();
            })
            .catch((cause) => setError(cause.message))
            .finally(() => setBusy(false));
        }
      }}
    />
  );
}
