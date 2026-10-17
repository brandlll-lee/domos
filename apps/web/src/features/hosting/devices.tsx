import { Button } from "@domos/ui/controls";
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
  const [items, setItems] = useState<Device[]>([]);
  const [pairing, setPairing] = useState<{ code: string; expires: number }>();
  const [scope, setScope] = useState("client");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(
    () => hostingRequest<Device[]>("devices").then(setItems),
    [],
  );
  useEffect(() => {
    void refresh().catch((error) => setError(error.message));
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
      aria-label="设备管理"
      aria-busy={busy}
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
                { value: "admin", label: "管理实例" },
              ]}
            />
          </SettingRow>
          <SettingRow
            title="一次性配对码"
            description="在另一台设备打开此实例地址并输入配对码。远程连接使用 HTTPS。"
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
        <h3>已连接设备</h3>
        <div className="settings-card">
          {items.map((item) => (
            <SettingRow
              title={item.label}
              description={item.scope === "admin" ? "管理员" : "使用 Bot"}
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
      </section>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
