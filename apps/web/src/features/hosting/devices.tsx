import { Button } from "@domos/ui/controls";
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
  const [error, setError] = useState("");
  const refresh = useCallback(
    () => hostingRequest<Device[]>("devices").then(setItems),
    [],
  );
  useEffect(() => {
    void refresh().catch((error) => setError(error.message));
  }, [refresh]);
  const run = async (action: () => Promise<unknown>) => {
    try {
      setError("");
      await action();
    } catch (error) {
      setError((error as Error).message);
    }
  };
  return (
    <section className="hosting-stack" aria-label="设备管理">
      <h2>连接其他设备</h2>
      <p className="detail-note">
        在另一台设备打开此实例地址，输入一次性配对码。远程连接使用 HTTPS。
      </p>
      <label>
        设备权限
        <select
          value={scope}
          onChange={(event) => setScope(event.target.value)}
        >
          <option value="client">使用 Bot</option>
          <option value="admin">管理实例</option>
        </select>
      </label>
      <Button
        variant="secondary"
        onClick={() =>
          void run(async () =>
            setPairing(await hostingRequest("pairing", { scope })),
          )
        }
      >
        生成配对码
      </Button>
      {pairing && (
        <div role="status">
          <code className="pairing-code">{pairing.code}</code>
          <p className="detail-note">
            有效至 {new Date(pairing.expires).toLocaleTimeString()}
            ，仅可使用一次。
          </p>
        </div>
      )}
      <h2>已连接设备</h2>
      {items.map((item) => (
        <div className="hosting-device" key={item.id}>
          <div>
            {item.label}
            {item.id === current ? " · 当前设备" : ""}
            <p className="detail-note">
              {item.scope === "admin" ? "管理员" : "使用 Bot"}
            </p>
          </div>
          {item.id !== current && (
            <Button
              variant="ghost"
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
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
