import type { ConnectionStatus } from "@domos/hosting/connection";
import { SegmentedControl } from "@domos/ui/choice";
import { Button, Switch } from "@domos/ui/controls";
import { ConfirmDialog } from "@domos/ui/dialog";
import { TextField } from "@domos/ui/field";
import { Loading } from "@domos/ui/loading";
import { PanelCard } from "@domos/ui/panel";
import { SettingRow } from "@domos/ui/setting-row";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { useEffect, useState } from "react";
import { useErrorNotice } from "../notices.tsx";
import { hostingRequest } from "./api.ts";

type Pairing = { code: string; expires: number; url: string };
const methods = [
  { value: "tailscale", label: "Tailscale" },
  { value: "https", label: "HTTPS 地址" },
] as const;

export function DeviceConnection() {
  const [connection, setConnection] = useState<ConnectionStatus>();
  const [mode, setMode] = useState<"tailscale" | "https">("tailscale");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pairing, setPairing] = useState<Pairing>();
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState("");
  const [admin, setAdmin] = useState(false);
  async function read(signal?: AbortSignal) {
    const result = await hostingRequest<ConnectionStatus>(
      "connection",
      undefined,
      "GET",
      signal,
    );
    if (signal?.aborted) return;
    setConnection(result);
    if (!connection) {
      setMode(result.mode === "https" ? "https" : "tailscale");
      setUrl(result.url ?? "");
    }
    return result;
  }
  useEffect(() => {
    const controller = new AbortController();
    void hostingRequest<ConnectionStatus>(
      "connection",
      undefined,
      "GET",
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setConnection(result);
        setMode(result.mode === "https" ? "https" : "tailscale");
        setUrl(result.url ?? "");
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    setQr("");
    if (!pairing) return;
    let active = true;
    void import("qrcode")
      .then((module) =>
        module.toDataURL(pairing.url, { width: 192, margin: 2 }),
      )
      .then((value) => {
        if (active) setQr(value);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    const expires = setTimeout(
      () => {
        setPairing(undefined);
        setCopied("");
      },
      Math.max(0, pairing.expires - Date.now()),
    );
    return () => {
      active = false;
      clearTimeout(expires);
    };
  }, [pairing]);
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "连接未完成。");
    } finally {
      setBusy(false);
    }
  }
  useErrorNotice(error, () => run(() => read()));
  async function configure(selected: "tailscale" | "https" | "off") {
    setFieldError("");
    try {
      const result = await hostingRequest<ConnectionStatus>("connection", {
        mode: selected,
        ...(selected === "https" ? { url: url.trim() } : {}),
      });
      setConnection(result);
      setPairing(undefined);
      setCopied("");
      setUrl(result.url ?? "");
      setConfirm(false);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "连接未完成。";
      if (selected === "off") setError(message);
      else setFieldError(message);
    }
  }
  const accepted =
    connection?.state === "ready" &&
    connection.mode === mode &&
    (mode !== "https" || url.trim().replace(/\/$/, "") === connection.url);
  const tailnet = connection?.tailscale;
  async function copy(value: string, message: string) {
    await navigator.clipboard.writeText(value);
    setCopied(message);
  }
  return (
    <section
      className="settings-sections"
      aria-label="连接新设备"
      aria-busy={busy || (!connection && !error)}
    >
      <SegmentedControl
        label="连接方式"
        value={mode}
        options={methods}
        disabled={busy || !connection}
        onValueChange={(value) => {
          setMode(value);
          setPairing(undefined);
          setFieldError("");
          setCopied("");
        }}
      />
      {!connection && !error && <Loading label="正在检测连接" />}
      {mode === "tailscale" && connection && (
        <PanelCard>
          <SettingRow
            title={
              tailnet?.state === "ready"
                ? "Tailscale 已连接"
                : tailnet?.state === "missing"
                  ? "Tailscale 未安装"
                  : "连接 Tailscale"
            }
            description={tailnet?.message}
          >
            {tailnet?.state === "missing" && (
              <Button
                variant="secondary"
                size="small"
                onClick={() =>
                  window.open(
                    "https://tailscale.com/download",
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
              >
                安装 Tailscale
              </Button>
            )}
            {["approval", "dns"].includes(tailnet?.state ?? "") && (
              <Button
                variant="secondary"
                size="small"
                onClick={() =>
                  window.open(
                    `https://login.tailscale.com/admin/${tailnet?.state === "approval" ? "machines" : "dns"}`,
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
              >
                打开管理台
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-small"
              aria-label="重新检测 Tailscale"
              pending={busy}
              onClick={() => void run(() => read())}
            >
              <ArrowClockwiseIcon />
            </Button>
          </SettingRow>
          {tailnet?.state === "ready" && (
            <SettingRow
              title="连接地址"
              description={tailnet.url}
              notice={fieldError || undefined}
            >
              <Button
                variant="secondary"
                disabled={busy || accepted}
                pending={busy}
                onClick={() => void run(() => configure("tailscale"))}
              >
                {accepted ? "已启用" : "启用连接"}
              </Button>
            </SettingRow>
          )}
        </PanelCard>
      )}
      {mode === "https" && (
        <PanelCard>
          <SettingRow
            title="服务器地址"
            description="填写已转发到这台电脑的地址。保存时会验证连接。"
          >
            <TextField
              label="HTTPS 地址"
              labelClassName="sr-only"
              value={url}
              onValueChange={(value) => {
                setUrl(value);
                setFieldError("");
                setPairing(undefined);
              }}
              placeholder="https://domos.example.com"
              type="url"
              disabled={busy}
              error={fieldError}
            />
            <Button
              variant="secondary"
              disabled={busy || !url.trim()}
              pending={busy}
              onClick={() => void run(() => configure("https"))}
            >
              保存并检测
            </Button>
          </SettingRow>
        </PanelCard>
      )}
      {connection?.state === "error" && (
        <PanelCard>
          <SettingRow title="连接尚未就绪" description={connection.error}>
            <Button
              variant="secondary"
              pending={busy}
              onClick={() => void run(() => read())}
            >
              重新检测
            </Button>
          </SettingRow>
        </PanelCard>
      )}
      {accepted && (
        <>
          {!pairing && (
            <>
              <PanelCard>
                <SettingRow
                  title="允许管理 Domos"
                  description="默认仅可使用 Bot。管理权限包含设置与设备授权。"
                >
                  <Switch
                    label="允许管理 Domos"
                    checked={admin}
                    onCheckedChange={setAdmin}
                    disabled={busy}
                  />
                </SettingRow>
              </PanelCard>
              <div className="form-actions">
                <Button
                  pending={busy}
                  onClick={() =>
                    void run(async () => {
                      setPairing(
                        await hostingRequest("pairing", {
                          scope: admin ? "admin" : "client",
                        }),
                      );
                      setCopied("");
                    })
                  }
                >
                  生成配对链接
                </Button>
              </div>
            </>
          )}
          {pairing && (
            <PanelCard>
              <div className="pairing-result">
                {qr && (
                  <img
                    className="pairing-qr"
                    src={qr}
                    width={192}
                    height={192}
                    alt="连接此 Domos 的二维码"
                  />
                )}
                <div className="pairing-copy">
                  <p>
                    {mode === "tailscale"
                      ? "另一台设备连接同一 Tailscale 网络后，扫码并确认连接。"
                      : "在另一台设备扫码，或打开链接后确认连接。"}
                  </p>
                  <code className="pairing-code">{pairing.code}</code>
                  <p className="detail-note">
                    有效至 {new Date(pairing.expires).toLocaleTimeString()}
                    ，仅可使用一次。
                    {admin ? "含管理员权限。" : "权限：使用 Bot。"}
                  </p>
                  <div className="form-actions">
                    <Button
                      variant="secondary"
                      onClick={() =>
                        void run(() => copy(pairing.url, "链接已复制"))
                      }
                    >
                      复制链接
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        void run(() => copy(pairing.code, "配对码已复制"))
                      }
                    >
                      复制配对码
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        setPairing(undefined);
                        setCopied("");
                      }}
                    >
                      重新生成
                    </Button>
                  </div>
                  <span role="status" className="detail-note">
                    {copied}
                  </span>
                </div>
              </div>
            </PanelCard>
          )}
          <p className="detail-note">
            这台电脑需保持开机，并运行 Domos。对方仍需确认配对才能访问。
          </p>
        </>
      )}
      {connection?.url && (
        <div className="form-actions">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setConfirm(true)}
          >
            关闭设备连接入口
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="关闭设备连接入口？"
        description="已配对设备的授权会保留。此操作不会关闭你自行配置的 HTTPS 代理。"
        confirmLabel="关闭入口"
        onConfirm={() => void run(() => configure("off"))}
      />
    </section>
  );
}
