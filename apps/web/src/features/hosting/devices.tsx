import { Button } from "@domos/ui/controls";
import { Loading } from "@domos/ui/loading";
import { Pagination } from "@domos/ui/pagination";
import { ChoicePicker } from "@domos/ui/picker";
import { SettingRow } from "@domos/ui/setting-row";
import { useCallback, useEffect, useState } from "react";
import { hostingRequest } from "./api.ts";

type Device = {
  id: string;
  label: string;
  scope: string;
  created: number;
  expires: number;
};

export function Devices({ current }: { current: string }) {
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
  return (
    <section
      className="settings-sections"
      aria-label="访问设备"
      aria-busy={busy || reading}
    >
      <section className="settings-group">
        <h3>连接其他设备</h3>
        <div className="settings-card">
          <SettingRow title="设备权限" description="选择新设备可以访问的功能。">
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
          <SettingRow
            title="一次性配对码"
            description="在另一台设备打开这个 Domos 的地址，再输入配对码。远程连接需要可访问的 HTTPS 地址。"
          >
            <Button
              size="small"
              disabled={busy}
              onClick={() =>
                void run(async () =>
                  setPairing(await hostingRequest("pairing", { scope })),
                )
              }
            >
              生成配对码
            </Button>
          </SettingRow>
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
      </section>
      <section className="settings-group">
        <h3>已授权访问</h3>
        {!result && reading && <Loading label="正在读取授权" />}
        <div className="settings-card">
          {result?.items.map((item) => (
            <SettingRow
              title={item.label}
              description={`${item.scope === "admin" ? "管理员" : "使用 Bot"} · 创建 ${new Date(item.created).toLocaleDateString()} · 有效至 ${new Date(item.expires).toLocaleDateString()}`}
              key={item.id}
            >
              {item.id === current ? (
                <span className="status-label">当前设备</span>
              ) : (
                <Button
                  variant="secondary"
                  size="small"
                  disabled={busy}
                  aria-label={`撤销${item.label}`}
                  onClick={() =>
                    void run(async () => {
                      await hostingRequest(
                        `devices/${item.id}`,
                        undefined,
                        "DELETE",
                      );
                      await refresh();
                    })
                  }
                >
                  撤销
                </Button>
              )}
            </SettingRow>
          ))}
        </div>
        {result && (
          <Pagination
            label="授权翻页"
            page={result.page}
            pageSize={10}
            total={result.total}
            onPage={setPage}
            disabled={busy || reading}
          />
        )}
      </section>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
