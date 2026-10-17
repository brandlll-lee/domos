import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { SettingRow } from "@domos/ui/setting-row";
import { useEffect, useState } from "react";
import type { DesktopState } from "./desktop.ts";

export function DataBackup() {
  const [state, setState] = useState<DesktopState>();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const desktop = window.domosDesktop;
  useEffect(() => {
    void desktop
      ?.state()
      .then((result) => {
        if (!result.ok) setError(result.error ?? "无法读取本机后台状态。");
        else setState(result.value);
      })
      .catch(() => setError("无法读取本机后台状态。"));
  }, []);
  async function run(action: "backup" | "restore") {
    if (!desktop || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await desktop.maintain(action, password);
      if (!result.ok) throw new Error(result.error);
      setMessage(result.value?.message ?? "操作已取消。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "备份操作未完成。");
    } finally {
      setBusy(false);
      setPassword("");
    }
  }
  return (
    <section
      className="detail-stack"
      aria-label="数据与备份"
      aria-busy={busy}
      data-dirty={Boolean(password)}
    >
      <p className="detail-note">
        操作会停止本机后台。完成后，从应用菜单打开本机 Domos。恢复会使用新目录。
      </p>
      {state?.mode === "local" && (
        <>
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
          <div className="settings-card">
            <SettingRow
              title="加密备份"
              description="选择保存位置，备份本机 Domos 的数据。"
            >
              <Button
                variant="secondary"
                size="small"
                disabled={busy || password.length < 12}
                onClick={() => void run("backup")}
              >
                创建备份
              </Button>
            </SettingRow>
            <SettingRow
              title="从备份恢复"
              description="选择备份文件，并输入创建备份时的密码。"
            >
              <Button
                variant="secondary"
                size="small"
                disabled={busy || password.length < 12}
                onClick={() => void run("restore")}
              >
                选择备份
              </Button>
            </SettingRow>
          </div>
        </>
      )}
      {state?.mode === "existing" && (
        <p role="status">请在运行此 Domos 的电脑上管理备份。</p>
      )}
      {!state && !error && <p role="status">正在读取本机后台状态…</p>}
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
    </section>
  );
}
