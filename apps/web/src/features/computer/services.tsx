import { Button, Switch } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { SettingRow } from "@domos/ui/setting-row";
import { useEffect, useState } from "react";
import { client } from "../../client.ts";
import { userError } from "../user-error.ts";
import { ComputerViewer } from "./viewer.tsx";

type Service = "browser" | "desktop";
const labels = { browser: "浏览器", desktop: "桌面" };

export function ComputerServices({
  botId,
  admin,
}: {
  botId: number;
  admin: boolean;
}) {
  const [state, setState] =
    useState<Awaited<ReturnType<typeof client.computer.services>>>();
  const [busy, setBusy] = useState<Service>();
  const [error, setError] = useState<string>();
  const [view, setView] = useState<Service>();
  useEffect(() => {
    const controller = new AbortController();
    void client.computer
      .services({ botId }, { signal: controller.signal })
      .then(setState)
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(userError(cause, "无法读取浏览器和桌面状态。请重试。"));
      });
    return () => controller.abort();
  }, [botId]);
  async function configure(
    service: Service,
    enabled: boolean,
    install = false,
  ) {
    if (busy) return;
    setBusy(service);
    setError(undefined);
    try {
      setState(
        await client.computer.service({ botId, service, enabled, install }),
      );
    } catch (cause) {
      setError(userError(cause, "电脑服务未能连接。请重试。"));
    } finally {
      setBusy(undefined);
    }
  }
  return (
    <section className="detail-stack" aria-label="浏览器和桌面">
      <div className="detail-form-head">
        <h3 className="detail-section-title">浏览器和桌面</h3>
        <p className="detail-note">
          Bot 和你可以操作同一工作环境。接管后，Bot 会暂停电脑操作。
        </p>
      </div>
      <div className="settings-card computer-services">
        {(["browser", "desktop"] as const).map((service) => {
          const item = state?.[service];
          return (
            <div key={service} className="computer-service">
              <SettingRow
                title={labels[service]}
                description={
                  item?.enabled
                    ? item.available
                      ? "已就绪"
                      : "需要检查"
                    : "未启用"
                }
              >
                <Switch
                  label={`允许${labels[service]}`}
                  checked={item?.enabled ?? false}
                  disabled={!admin || Boolean(busy) || !state}
                  onCheckedChange={(enabled) =>
                    void configure(service, enabled)
                  }
                />
              </SettingRow>
              {item?.enabled && (
                <div className="computer-service-actions">
                  {item.error && (
                    <p role="alert" className="detail-note">
                      {item.error}
                    </p>
                  )}
                  <div className="form-actions">
                    <Button
                      variant="secondary"
                      size="small"
                      disabled={Boolean(busy)}
                      onClick={() => setView(service)}
                    >
                      查看{labels[service]}
                    </Button>
                    {admin && (
                      <Button
                        variant="ghost"
                        size="small"
                        pending={busy === service}
                        onClick={() => void configure(service, true)}
                      >
                        检查连接
                      </Button>
                    )}
                    {admin && service === "browser" && !item.available && (
                      <Button
                        variant="ghost"
                        size="small"
                        disabled={Boolean(busy)}
                        onClick={() => void configure(service, true, true)}
                      >
                        下载浏览器
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      <Dialog
        open={Boolean(view)}
        onOpenChange={(open) => {
          if (!open) setView(undefined);
        }}
        title={view ? labels[view] : "工作电脑"}
        className="computer-view-dialog"
      >
        {view && <ComputerViewer botId={botId} service={view} />}
      </Dialog>
    </section>
  );
}
