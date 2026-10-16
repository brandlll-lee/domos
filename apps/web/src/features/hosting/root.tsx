import { BrandMark } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { hostingRequest } from "./api.ts";
import { Devices } from "./devices.tsx";
import { HostingModels } from "./models.tsx";
import "./style.css";

const HostingContext = createContext<(() => void) | undefined>(undefined);
type Session = { device: { id: string; scope: string }; configured: boolean };

export function HostingButton() {
  const open = useContext(HostingContext);
  return open ? (
    <Button variant="ghost" onClick={open}>
      管理实例
    </Button>
  ) : null;
}

export function HostingRoot({ children }: { children: ReactNode }) {
  const [state, setState] = useState<
    "loading" | "pair" | "ready" | "setup" | "standalone"
  >("loading");
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("devices");
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
    setState(value.configured ? "ready" : "setup");
  }, []);
  useEffect(() => {
    const parameters = new URLSearchParams(window.location.hash.slice(1));
    const owner = parameters.get("pair");
    if (owner) {
      setCode(owner);
      window.history.replaceState(null, "", window.location.pathname);
    }
    void refresh().catch((error) => setError(error.message));
    const unauthorized = () => {
      setSession(undefined);
      setState("pair");
    };
    window.addEventListener("domos:pair", unauthorized);
    return () => window.removeEventListener("domos:pair", unauthorized);
  }, [refresh]);
  if (state === "standalone") return children;
  if (state === "ready")
    return (
      <HostingContext
        value={
          session?.device.scope === "admin" ? () => setOpen(true) : undefined
        }
      >
        {children}
        {open && (
          <aside
            className="hosting-panel"
            aria-label="实例管理"
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
            }}
          >
            <header className="hosting-device">
              <h2>实例管理</h2>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                关闭
              </Button>
            </header>
            <nav className="hosting-tabs" aria-label="实例设置分区">
              <Button
                variant="ghost"
                aria-pressed={tab === "devices"}
                onClick={() => setTab("devices")}
              >
                设备
              </Button>
              <Button
                variant="ghost"
                aria-pressed={tab === "models"}
                onClick={() => setTab("models")}
              >
                模型
              </Button>
            </nav>
            {tab === "devices" ? (
              <Devices current={session?.device.id ?? ""} />
            ) : (
              <HostingModels onConfigured={() => setOpen(false)} />
            )}
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
        {state === "setup" &&
          (session?.device.scope === "admin" ? (
            <HostingModels onConfigured={() => void refresh()} />
          ) : (
            <p role="status">请让管理员完成模型配置。</p>
          ))}
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
