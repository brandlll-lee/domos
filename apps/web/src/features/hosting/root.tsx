import { BrandMark } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { ComputerSettings } from "../computer/settings.tsx";
import { hostingRequest } from "./api.ts";
import { DesktopSettings } from "./desktop.tsx";
import { Devices } from "./devices.tsx";
import { HostingModels } from "./models.tsx";
import "./style.css";

type SettingsTab = "devices" | "models" | "computers" | "instance";
const HostingContext = createContext<{
  open: (tab?: SettingsTab, botId?: number) => void;
  admin: boolean;
}>({ open: () => {}, admin: false });
export const useHosting = () => useContext(HostingContext);
type Session = { device: { id: string; scope: string } };

export function HostingButton() {
  const settings = useHosting();
  return (
    <Button variant="ghost" onClick={() => settings.open()}>
      设置
    </Button>
  );
}

export function HostingRoot({ children }: { children: ReactNode }) {
  const [state, setState] = useState<
    "loading" | "pair" | "ready" | "standalone"
  >("loading");
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SettingsTab>("computers");
  const [botId, setBotId] = useState<number>();
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("我的设备");
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    panel.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [open]);
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
      <HostingContext
        value={{
          open: (next = "computers", target) => {
            setTab(next);
            setBotId(target);
            setOpen(true);
          },
          admin: session?.device.scope === "admin" || state === "standalone",
        }}
      >
        {children}
        {open && (
          <aside
            className="hosting-panel"
            aria-label="设置"
            ref={panel}
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
            }}
          >
            <header className="hosting-device">
              <h2>设置</h2>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                关闭
              </Button>
            </header>
            <nav className="hosting-tabs" aria-label="设置分区">
              {(
                [
                  ["computers", "电脑"],
                  ["models", "模型"],
                  ["devices", "设备"],
                  ["instance", "实例"],
                ] as const
              ).map(([key, name]) => (
                <Button
                  key={key}
                  variant="ghost"
                  aria-pressed={tab === key}
                  onClick={() => setTab(key)}
                >
                  {name}
                </Button>
              ))}
            </nav>
            {tab === "computers" && (
              <ComputerSettings
                admin={
                  session?.device.scope === "admin" || state === "standalone"
                }
              />
            )}
            {tab === "models" &&
              (session?.device.scope === "admin" ? (
                <HostingModels
                  botId={botId}
                  onConfigured={() => setOpen(false)}
                />
              ) : (
                <p role="status">
                  请让管理员连接模型。已连接的模型可在 Bot 详情中选择。
                </p>
              ))}
            {tab === "devices" &&
              (session?.device.scope === "admin" ? (
                <Devices current={session.device.id} />
              ) : (
                <p role="status">请让管理员管理设备。</p>
              ))}
            {tab === "instance" && <DesktopSettings />}
          </aside>
        )}
      </HostingContext>
    );
  return (
    <main className="hosting-welcome">
      <div className="hosting-card">
        <div className="wordmark">
          <BrandMark />
          domos.
        </div>
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
                value={label}
                maxLength={80}
                onChange={(event) => setLabel(event.target.value)}
                required
              />
            </label>
            <label>
              配对码
              <input
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
  );
}
