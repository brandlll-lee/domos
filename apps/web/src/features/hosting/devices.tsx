import { Button } from "@domos/ui/controls";
import { ConfirmDialog, Dialog } from "@domos/ui/dialog";
import { Loading } from "@domos/ui/loading";
import { Pagination } from "@domos/ui/pagination";
import { PanelCard, PanelRow } from "@domos/ui/panel";
import { ChoicePicker } from "@domos/ui/picker";
import { SettingRow } from "@domos/ui/setting-row";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { DevicesIcon } from "@phosphor-icons/react/dist/csr/Devices";
import { useCallback, useEffect, useRef, useState } from "react";
import { useErrorNotice } from "../notices.tsx";
import { hostingRequest } from "./api.ts";

type Device = {
  id: string;
  label: string;
  scope: string;
  created: number;
  expires: number;
};

export function Devices({
  current,
  open,
  onOpen,
}: {
  current: string;
  open: boolean;
  onOpen: () => void;
}) {
  const content = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement>(null);
  const [connecting, setConnecting] = useState(false);
  const [selected, setSelected] = useState<Device>();
  const [revoking, setRevoking] = useState(false);
  const [result, setResult] = useState<{
    items: Device[];
    total: number;
    page: number;
    pageSize: number;
  }>();
  const [page, setPage] = useState(1);
  const [pairing, setPairing] = useState<{ code: string; expires: number }>();
  const [scope, setScope] = useState("client");
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      setReading(true);
      try {
        const value = await hostingRequest<{
          items: Device[];
          total: number;
          page: number;
          pageSize: number;
        }>(`devices?page=${page}`, undefined, "GET", signal);
        if (!signal?.aborted) {
          setResult(value);
          setPage(value.page);
        }
      } finally {
        if (!signal?.aborted) setReading(false);
      }
    },
    [page],
  );
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch((error) => {
      if (!controller.signal.aborted) setError(error.message);
    });
    return () => controller.abort();
  }, [refresh]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      setError("");
      await action();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useErrorNotice(error, () => run(() => refresh()));
  const returnFocus = () =>
    opener.current?.isConnected ? opener.current : content.current;
  return (
    <>
      <div hidden={open}>
        <PanelCard>
          <PanelRow
            icon={<DevicesIcon />}
            title="设备访问"
            value={result ? `已授权 ${result.total} 台` : "正在读取…"}
            onClick={onOpen}
          />
        </PanelCard>
      </div>
      <section
        ref={content}
        tabIndex={-1}
        hidden={!open}
        className="settings-sections"
        aria-label="访问设备"
        aria-busy={busy || reading}
      >
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
            variant="secondary"
            size="small"
            onClick={() => {
              opener.current = document.activeElement as HTMLElement;
              setPairing(undefined);
              setScope("client");
              setConnecting(true);
            }}
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
                  key={item.id}
                  icon={<DevicesIcon />}
                  title={item.label}
                  value={
                    item.id === current
                      ? "当前设备"
                      : item.scope === "admin"
                        ? "管理员"
                        : "使用 Bot"
                  }
                  onClick={() => {
                    opener.current = document.activeElement as HTMLElement;
                    setSelected(item);
                  }}
                />
              ))}
            </PanelCard>
            {!result.total && <p className="detail-note">还没有已授权设备。</p>}
            <Pagination
              label="授权翻页"
              page={result.page}
              pageSize={result.pageSize}
              total={result.total}
              onPage={setPage}
              disabled={busy || reading}
            />
          </>
        )}
        <Dialog
          open={connecting}
          finalFocus={returnFocus}
          onOpenChange={(open) => {
            if (!busy) setConnecting(open);
          }}
          title="连接新设备"
          footer={
            <div className="dialog-actions">
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setConnecting(false)}
              >
                关闭
              </Button>
              {!pairing && (
                <Button
                  pending={busy}
                  onClick={() =>
                    void run(async () =>
                      setPairing(await hostingRequest("pairing", { scope })),
                    )
                  }
                >
                  生成配对码
                </Button>
              )}
            </div>
          }
        >
          <div className="settings-sections">
            {!pairing && (
              <SettingRow
                title="设备权限"
                description={
                  scope === "admin"
                    ? "可修改设置、管理授权，并使用 Bot。"
                    : "可使用 Bot，不能管理设置和设备授权。"
                }
              >
                <ChoicePicker
                  label="设备权限"
                  size="small"
                  value={scope}
                  disabled={busy}
                  onValueChange={setScope}
                  items={[
                    { value: "client", label: "使用 Bot" },
                    { value: "admin", label: "管理 Domos" },
                  ]}
                />
              </SettingRow>
            )}
            <p className="detail-note">
              在另一台设备打开这个 Domos
              的地址，再输入配对码。远程连接需要可访问的 HTTPS 地址。
            </p>
            {pairing && (
              <div className="pairing-result" role="status">
                <code className="pairing-code">{pairing.code}</code>
                <p className="detail-note">
                  有效至 {new Date(pairing.expires).toLocaleTimeString()}
                  ，仅可使用一次。
                </p>
              </div>
            )}
          </div>
        </Dialog>
        <Dialog
          open={Boolean(selected)}
          finalFocus={returnFocus}
          onOpenChange={(open) => {
            if (!open) setSelected(undefined);
          }}
          title={selected?.label ?? "设备详情"}
          footer={
            selected?.id !== current && (
              <div className="dialog-actions">
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setRevoking(true)}
                >
                  撤销访问
                </Button>
              </div>
            )
          }
        >
          {selected && (
            <PanelCard>
              <SettingRow title="权限">
                {selected.scope === "admin" ? "管理员" : "使用 Bot"}
              </SettingRow>
              {selected.id === current && (
                <SettingRow title="设备">当前设备</SettingRow>
              )}
              <SettingRow title="授权时间">
                {new Date(selected.created).toLocaleString()}
              </SettingRow>
              <SettingRow title="有效至">
                {new Date(selected.expires).toLocaleString()}
              </SettingRow>
            </PanelCard>
          )}
        </Dialog>
        <ConfirmDialog
          open={revoking}
          onOpenChange={setRevoking}
          title={`撤销 ${selected?.label ?? "设备"} 的访问？`}
          description="此设备将断开连接，需要重新配对才能访问。"
          confirmLabel="撤销访问"
          onConfirm={() =>
            void run(async () => {
              await hostingRequest(
                `devices/${selected?.id}`,
                undefined,
                "DELETE",
              );
              setSelected(undefined);
              await refresh();
            })
          }
        />
      </section>
    </>
  );
}
