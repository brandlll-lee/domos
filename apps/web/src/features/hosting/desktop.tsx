import { Button } from "@domos/ui/controls";
import { useEffect, useState } from "react";

type Result<T = { message?: string }> = {
  ok: boolean;
  value?: T;
  error?: string;
};
type State = {
  instances: { id: string; name: string }[];
  selected?: string;
  running: boolean;
};
declare global {
  interface Window {
    domosDesktop?: {
      prepare(): Promise<Result<{ image: string; proxyImage?: string }>>;
      state(): Promise<Result<State>>;
      local(): Promise<Result>;
      select(id: string): Promise<Result>;
      connect(url: string, name: string): Promise<Result>;
      maintain(
        action: "backup" | "restore",
        password: string,
      ): Promise<Result<{ message: string }>>;
    };
  }
}

export function DesktopSettings() {
  const [state, setState] = useState<State>();
  const [name, setName] = useState("我的 Domos");
  const [url, setUrl] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    void window.domosDesktop?.state().then((result) => setState(result.value));
  }, []);
  const desktop = window.domosDesktop;
  if (!desktop)
    return (
      <p className="detail-note">
        此页面连接当前 Domos
        实例。可使用桌面版管理已有实例和加密备份。自托管无需云账号。
      </p>
    );
  async function run(action: () => Promise<Result<{ message?: string }>>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await action();
      if (!result.ok) throw new Error(result.error);
      setMessage(result.value?.message ?? "操作已完成。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作未完成。");
    } finally {
      setBusy(false);
      setPassword("");
    }
  }
  return (
    <section className="hosting-stack" aria-label="实例管理" aria-busy={busy}>
      <h3>实例</h3>
      <p className="detail-note">
        本机后台在这台电脑上运行。自托管无需云账号。
      </p>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() => void run(() => desktop.local())}
      >
        打开本机 Domos
      </Button>
      {state?.instances.map((instance) => (
        <Button
          key={instance.id}
          variant="ghost"
          disabled={busy || state.selected === instance.id}
          onClick={() => void run(() => desktop.select(instance.id))}
        >
          {instance.name}
        </Button>
      ))}
      <form
        className="hosting-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => desktop.connect(url, name));
        }}
      >
        <label>
          实例名称
          <input
            value={name}
            maxLength={80}
            required
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          服务器地址
          <input
            value={url}
            placeholder="https://domos.example.com"
            required
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <Button type="submit" disabled={busy}>
          连接已有 Domos
        </Button>
      </form>
      <details>
        <summary>备份与恢复</summary>
        <p className="detail-note">
          备份会停止本机后台。恢复使用新目录。完成后可重新打开本机实例。
        </p>
        <label className="hosting-stack">
          备份密码
          <input
            type="password"
            value={password}
            minLength={12}
            autoComplete="new-password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <div className="detail-actions">
          {(
            [
              ["backup", "加密备份"],
              ["restore", "从备份恢复"],
            ] as const
          ).map(([action, label]) => (
            <Button
              key={action}
              variant="secondary"
              disabled={busy || password.length < 12}
              onClick={() => void run(() => desktop.maintain(action, password))}
            >
              {label}
            </Button>
          ))}
        </div>
      </details>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
