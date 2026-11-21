import type { Device } from "@domos/hosting/sessions";
import { Button, Switch } from "@domos/ui/controls";
import { ConfirmDialog } from "@domos/ui/dialog";
import { Loading } from "@domos/ui/loading";
import { Pagination } from "@domos/ui/pagination";
import { PanelCard, PanelRow } from "@domos/ui/panel";
import { SettingRow } from "@domos/ui/setting-row";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { DevicesIcon } from "@phosphor-icons/react/dist/csr/Devices";
import { useCallback, useEffect, useState } from "react";
import { useErrorNotice } from "../notices.tsx";
import { hostingRequest } from "./api.ts";

type DevicePage = {
  items: Device[];
  total: number;
  page: number;
  pageSize: number;
};
type Connection = {
  state: "local" | "ready" | "error";
  url?: string;
  error?: string;
};
type Pairing = { code: string; expires: number; url: string };
const time = (value: number | null) =>
  value ? new Date(value).toLocaleString() : "未知";

export function Devices({
  current,
  page,
  onPageChange,
}: {
  current: string;
  page?: string;
  onPageChange: (page?: string) => void;
}) {
  const [selected, setSelected] = useState<Device>();
  const [result, setResult] = useState<DevicePage>();
  const [number, setNumber] = useState(1);
  const [connection, setConnection] = useState<Connection>();
  const [pairing, setPairing] = useState<Pairing>();
  const [qr, setQr] = useState("");
  const [admin, setAdmin] = useState(false);
  const [preview, setPreview] = useState<Device[]>();
  const [previewPage, setPreviewPage] = useState(1);
  const [confirm, setConfirm] = useState<"device" | "others">();
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      setReading(true);
      try {
        const value = await hostingRequest<DevicePage>(
          `devices?page=${number}`,
          undefined,
          "GET",
          signal,
        );
        if (!signal?.aborted) {
          setResult(value);
          setNumber(value.page);
        }
      } finally {
        if (!signal?.aborted) setReading(false);
      }
    },
    [number],
  );
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch((cause) => {
      if (!controller.signal.aborted) setError(cause.message);
    });
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    if (page !== "connection") return;
    const controller = new AbortController();
    setConnection(undefined);
    setPairing(undefined);
    setAdmin(false);
    setCopied("");
    void hostingRequest<Connection>(
      "connection",
      undefined,
      "GET",
      controller.signal,
    )
      .then(setConnection)
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message);
      });
    return () => controller.abort();
  }, [page]);
  useEffect(() => {
    setQr("");
    if (!pairing || page !== "connection") return;
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
    return () => {
      active = false;
    };
  }, [pairing, page]);
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作未完成。");
    } finally {
      setBusy(false);
    }
  }
  useErrorNotice(error, () => run(() => refresh()));
  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
  }
  if (!page)
    return (
      <PanelCard>
        <PanelRow
          id="device-access"
          icon={<DevicesIcon />}
          title="设备访问"
          onClick={() => onPageChange("devices")}
        />
      </PanelCard>
    );
  if (page === "connection")
    return (
      <section
        className="settings-sections"
        aria-label="连接新设备"
        aria-busy={busy}
      >
        {!connection && !error && <Loading label="正在检查连接地址" />}
        {connection?.state === "local" && (
          <PanelCard>
            <SettingRow
              title="仅本机可用"
              description="在 domos.config.json 配置 publicUrl，并通过 HTTPS 反向代理指向此服务。配置后重启 Domos，再连接其他设备。"
            />
          </PanelCard>
        )}
        {connection?.state === "error" && (
          <PanelCard>
            <SettingRow title="连接验证失败" description={connection.error}>
              <Button
                variant="secondary"
                pending={busy}
                onClick={() =>
                  void run(async () =>
                    setConnection(await hostingRequest("connection")),
                  )
                }
              >
                重试
              </Button>
            </SettingRow>
          </PanelCard>
        )}
        {connection?.state === "ready" && (
          <>
            <PanelCard>
              <SettingRow title="连接地址" description={connection.url} />
              {!pairing && (
                <SettingRow
                  title="允许管理 Domos"
                  description="默认可使用 Bot。开启后，还可修改设置和管理设备授权。"
                >
                  <Switch
                    label="允许管理 Domos"
                    checked={admin}
                    onCheckedChange={setAdmin}
                    disabled={busy}
                  />
                </SettingRow>
              )}
            </PanelCard>
            {!pairing ? (
              <div className="form-actions">
                <Button
                  pending={busy}
                  onClick={() =>
                    void run(async () =>
                      setPairing(
                        await hostingRequest("pairing", {
                          scope: admin ? "admin" : "client",
                        }),
                      ),
                    )
                  }
                >
                  生成配对链接
                </Button>
              </div>
            ) : (
              <>
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
                      <p>在另一台设备扫码，或打开链接后确认连接。</p>
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
                      </div>
                      <span role="status" className="detail-note">
                        {copied}
                      </span>
                    </div>
                  </div>
                </PanelCard>
                <p className="detail-note">
                  若另一台设备无法打开，请检查它能否访问此 HTTPS 地址。
                </p>
                <div className="form-actions">
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
              </>
            )}
          </>
        )}
      </section>
    );
  return (
    <section
      className="settings-sections"
      aria-label="访问设备"
      aria-busy={busy || reading}
    >
      {page === "devices" && (
        <>
          <div className="form-actions">
            <Button
              variant="ghost"
              size="icon-small"
              aria-label="刷新设备"
              pending={reading}
              disabled={busy}
              onClick={() => void run(() => refresh())}
            >
              <ArrowClockwiseIcon />
            </Button>
            <Button
              id="device-revocation"
              variant="ghost"
              size="small"
              disabled={busy || !result || result.total < 2}
              onClick={() =>
                void run(async () => {
                  const value = await hostingRequest<{ items: Device[] }>(
                    "devices/revocation",
                  );
                  setPreview(value.items);
                  setPreviewPage(1);
                  onPageChange("revocation");
                })
              }
            >
              撤销其他登录
            </Button>
            <Button
              id="device-connection"
              variant="secondary"
              size="small"
              onClick={() => onPageChange("connection")}
            >
              连接新设备
            </Button>
          </div>
          {!result && reading && <Loading label="正在读取授权" />}
          {result && (
            <>
              <PanelCard>
                {result.items.map((item) => (
                  <PanelRow
                    id={`device-access-${item.id}`}
                    key={item.id}
                    icon={<DevicesIcon />}
                    title={item.label}
                    description={`最近访问：${time(item.lastSeen)}`}
                    value={`${item.id === current ? "当前设备 · " : ""}${item.scope === "admin" ? "管理员" : "使用 Bot"}`}
                    onClick={() => {
                      setSelected(item);
                      onPageChange("device");
                    }}
                  />
                ))}
              </PanelCard>
              <Pagination
                label="授权翻页"
                page={result.page}
                pageSize={result.pageSize}
                total={result.total}
                onPage={setNumber}
                disabled={busy || reading}
              />
            </>
          )}
        </>
      )}
      {page === "device" && selected && (
        <>
          <PanelCard>
            <SettingRow
              title={selected.label}
              description={selected.id === current ? "当前设备" : undefined}
            />
            <SettingRow title="权限">
              {selected.scope === "admin" ? "管理员" : "使用 Bot"}
            </SettingRow>
            <SettingRow title="最近访问">{time(selected.lastSeen)}</SettingRow>
            <SettingRow title="授权时间">{time(selected.created)}</SettingRow>
            <SettingRow title="有效至">{time(selected.expires)}</SettingRow>
          </PanelCard>
          {selected.id !== current && (
            <div className="form-actions">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setConfirm("device")}
              >
                撤销访问
              </Button>
            </div>
          )}
        </>
      )}
      {page === "revocation" && preview && (
        <>
          <p className="detail-note">
            保留当前设备。以下 {preview.length} 条登录将断开连接，需要重新配对。
          </p>
          <PanelCard>
            {preview
              .slice((previewPage - 1) * 10, previewPage * 10)
              .map((item) => (
                <SettingRow
                  key={item.id}
                  title={item.label}
                  description={`最近访问：${time(item.lastSeen)}`}
                >
                  {item.scope === "admin" ? "管理员" : "使用 Bot"}
                </SettingRow>
              ))}
          </PanelCard>
          <Pagination
            label="清理预览翻页"
            page={previewPage}
            pageSize={10}
            total={preview.length}
            onPage={setPreviewPage}
            disabled={busy}
          />
          <div className="form-actions">
            <Button variant="secondary" onClick={() => onPageChange("devices")}>
              取消
            </Button>
            <Button
              disabled={busy || !preview.length}
              onClick={() => setConfirm("others")}
            >
              确认撤销其他登录
            </Button>
          </div>
        </>
      )}
      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(open) => {
          if (!open) setConfirm(undefined);
        }}
        title={
          confirm === "others"
            ? `撤销这 ${preview?.length ?? 0} 条登录？`
            : `撤销 ${selected?.label ?? "设备"} 的访问？`
        }
        description={
          confirm === "others"
            ? "保留当前设备。列表中的其他设备将断开连接，需要重新配对。"
            : "此设备将断开连接，需要重新配对才能访问。"
        }
        confirmLabel="撤销访问"
        onConfirm={() =>
          void run(async () => {
            if (confirm === "others")
              await hostingRequest("devices/revocation", {
                ids: preview?.map((item) => item.id) ?? [],
              });
            else if (selected)
              await hostingRequest(
                `devices/${selected.id}`,
                undefined,
                "DELETE",
              );
            setSelected(undefined);
            setPreview(undefined);
            onPageChange("devices");
            await refresh();
          })
        }
      />
    </section>
  );
}
