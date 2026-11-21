import type { Device } from "@domos/hosting/sessions";
import { Button } from "@domos/ui/controls";
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
import { DeviceConnection } from "./connection.tsx";

type DevicePage = {
  items: Device[];
  total: number;
  page: number;
  pageSize: number;
};
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
  const [preview, setPreview] = useState<Device[]>();
  const [previewPage, setPreviewPage] = useState(1);
  const [confirm, setConfirm] = useState<"device" | "others">();
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
  if (page === "connection") return <DeviceConnection />;
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
