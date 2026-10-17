import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { SettingRow } from "@domos/ui/setting-row";
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
      platform: string;
      appearance(theme: "light" | "dark"): Promise<Result>;
      menu(): Promise<Result>;
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
    <section
      className="settings-sections"
      aria-label="实例管理"
      aria-busy={busy}
      data-dirty={Boolean(url || password)}
    >
      <section className="settings-group">
        <h3>已有实例</h3>
        <div className="settings-card">
          <SettingRow
            title="本机后台"
            description="在这台电脑上运行。自托管无需云账号。"
          >
            <Button
              variant="secondary"
              size="small"
              disabled={busy}
              onClick={() => void run(() => desktop.local())}
            >
              打开本机 Domos
            </Button>
          </SettingRow>
          {state?.instances.map((instance) => (
            <SettingRow
              title={instance.name}
              description="已保存的实例连接"
              key={instance.id}
            >
              {state.selected === instance.id ? (
                <span className="status-label">当前实例</span>
              ) : (
                <Button
                  variant="secondary"
                  size="small"
                  aria-label={`打开${instance.name}`}
                  disabled={busy}
                  onClick={() => void run(() => desktop.select(instance.id))}
                >
                  打开
                </Button>
              )}
            </SettingRow>
          ))}
        </div>
      </section>
      <section className="settings-group">
        <h3>连接实例</h3>
        <form
          className="settings-form settings-card"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => desktop.connect(url, name));
          }}
        >
          <TextField
            label="实例名称"
            value={name}
            maxLength={80}
            required
            disabled={busy}
            onValueChange={setName}
          />
          <TextField
            label="服务器地址"
            value={url}
            placeholder="https://domos.example.com"
            required
            disabled={busy}
            onValueChange={setUrl}
          />
          <div className="form-actions">
            <Button type="submit" size="small" disabled={busy}>
              连接已有 Domos
            </Button>
          </div>
        </form>
      </section>
      <section className="settings-group">
        <h3>备份与恢复</h3>
        <p className="detail-note">
          备份会停止本机后台。恢复使用新目录。完成后可重新打开本机实例。
        </p>
        <div className="settings-card">
          <div className="settings-form">
            <TextField
              label="备份密码"
              type="password"
              value={password}
              minLength={12}
              placeholder="至少 12 个字符"
              autoComplete="new-password"
              disabled={busy}
              onValueChange={setPassword}
            />
          </div>
          {(
            [
              ["backup", "加密备份", "选择保存位置并创建加密备份。"],
              ["restore", "从备份恢复", "选择备份文件，恢复到新目录。"],
            ] as const
          ).map(([action, label, description]) => (
            <SettingRow key={action} title={label} description={description}>
              <Button
                variant="secondary"
                size="small"
                disabled={busy || password.length < 12}
                onClick={() =>
                  void run(() => desktop.maintain(action, password))
                }
              >
                {label}
              </Button>
            </SettingRow>
          ))}
        </div>
      </section>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
