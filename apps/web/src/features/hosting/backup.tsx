import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { Loading } from "@domos/ui/loading";
import { InlineNotice } from "@domos/ui/message";
import { SettingRow } from "@domos/ui/setting-row";
import { useEffect, useState } from "react";
import { client } from "../../client.ts";
import { clearFiles } from "../files/file-state.ts";
import type { DesktopState } from "./desktop.ts";

export function DataBackup() {
  const [state, setState] = useState<DesktopState>();
  const [usage, setUsage] =
    useState<Awaited<ReturnType<typeof client.storage.usage>>>();
  const [temporary, setTemporary] = useState<number>();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const desktop = window.domosDesktop;
  useEffect(() => {
    void desktop
      ?.fileCache("usage")
      .then((result) => {
        if (result.ok) setTemporary(result.value?.bytes);
      })
      .catch(() => {});
    void client.storage
      .usage()
      .then(setUsage)
      .catch(() => setError("无法读取当前电脑的数据占用。"));
    void desktop
      ?.state()
      .then((result) => {
        if (!result.ok) setError(result.error ?? "无法读取本机后台状态。");
        else setState(result.value);
      })
      .catch(() => setError("无法读取本机后台状态。"));
  }, []);
  async function run(action: "backup" | "restore" | "compact") {
    if (!desktop || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await desktop.maintain(action, password);
      if (!result.ok) throw new Error(result.error);
      setMessage(result.value?.message ?? "操作已取消。");
      if (action === "compact") setUsage(await client.storage.usage());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "备份操作未完成。");
    } finally {
      setBusy(false);
      setPassword("");
    }
  }
  async function clear() {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setUsage(await client.storage.clear());
      if (desktop) {
        const result = await desktop.fileCache("clear");
        if (!result.ok) throw new Error(result.error);
        setTemporary(result.value?.bytes);
      }
      clearFiles();
      setMessage("预览缓存已清理。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "清理未完成。");
    } finally {
      setBusy(false);
    }
  }
  const size = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return (
    <section
      className="detail-stack"
      aria-label="数据与备份"
      aria-busy={busy}
      data-dirty={Boolean(password)}
    >
      <div className="settings-card">
        <SettingRow
          title="当前电脑的数据"
          description={
            usage
              ? `数据库 ${size(usage.databaseBytes)} · 正式附件 ${size(usage.attachmentBytes)} · 预览缓存 ${size(usage.previewBytes)}。采样于 ${new Date(usage.sampledAt).toLocaleTimeString()}。工作目录、草稿和备份不计入此统计。`
              : "正在读取占用…"
          }
        >
          <Button
            variant="secondary"
            size="small"
            disabled={busy}
            onClick={() => {
              void client.storage
                .usage()
                .then(setUsage)
                .catch(() => setError("无法刷新占用。"));
            }}
          >
            刷新
          </Button>
        </SettingRow>
        <SettingRow
          title="预览缓存"
          description="清理可重新生成的缩略图和链接预览。正式附件和工作文件会保留。"
        >
          <Button
            variant="secondary"
            size="small"
            pending={busy}
            onClick={() => void clear()}
          >
            清理缓存
          </Button>
        </SettingRow>
        {state?.mode === "local" && (
          <SettingRow
            title="整理数据库"
            description={`预计回收 ${size(usage?.reclaimableBytes ?? 0)}。所有任务空闲后，后台会短暂重启。`}
          >
            <Button
              variant="secondary"
              size="small"
              disabled={busy || !usage?.reclaimableBytes}
              onClick={() => void run("compact")}
            >
              整理数据库
            </Button>
          </SettingRow>
        )}
      </div>
      {temporary !== undefined && (
        <p className="detail-note">
          本机文件副本 {size(temporary)}。清理只移除超过 24
          小时的未完成下载，已打开的文件副本会保留。
        </p>
      )}
      {state?.mode === "local" && (
        <p className="detail-note">
          备份与恢复会停止本机后台。完成后，从应用菜单打开本机
          Domos。恢复会使用新目录。
        </p>
      )}
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
      {desktop && !state && !error && <Loading label="正在读取本机后台状态" />}
      {message && (
        <div role="status">
          <InlineNotice>{message}</InlineNotice>
        </div>
      )}
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
    </section>
  );
}
