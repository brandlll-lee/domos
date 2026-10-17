import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { SettingRow } from "@domos/ui/setting-row";
import { useState } from "react";
import { AppearancePicker } from "../appearance/picker.tsx";
import { DataBackup } from "../hosting/backup.tsx";
import { Devices } from "../hosting/devices.tsx";
import { useSettings } from "./context.ts";
import type { SettingsAccess } from "./sections.tsx";

export function GeneralSettings({ admin, deviceId }: SettingsAccess) {
  const settings = useSettings();
  const [flow, setFlow] = useState<"access" | "backup" | null>(null);
  return (
    <div className="settings-sections">
      <section className="settings-group">
        <h3>显示</h3>
        <div className="settings-card">
          <SettingRow title="主题" description="选择浅色、深色或跟随系统。">
            <AppearancePicker />
          </SettingRow>
        </div>
      </section>
      {admin && deviceId && (
        <section className="settings-group">
          <h3>访问</h3>
          <div className="settings-card">
            <SettingRow
              title="在其他设备上使用"
              description="连接手机或另一台电脑，继续使用这些 Bot。"
            >
              <Button
                variant="secondary"
                size="small"
                onClick={() => setFlow("access")}
              >
                连接设备
              </Button>
            </SettingRow>
          </div>
        </section>
      )}
      {admin && (
        <section className="settings-group">
          <h3>管理</h3>
          <div className="settings-card">
            <SettingRow
              title="电脑高级管理"
              description="管理镜像、远程连接和容器。Bot 的工作环境可在对话中选择。"
            >
              <Button
                variant="secondary"
                size="small"
                onClick={() => settings.open("computers")}
              >
                打开
              </Button>
            </SettingRow>
            {window.domosDesktop && (
              <SettingRow
                title="数据与备份"
                description="创建加密备份，或从备份恢复。"
              >
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => setFlow("backup")}
                >
                  管理备份
                </Button>
              </SettingRow>
            )}
          </div>
        </section>
      )}
      <Dialog
        open={flow === "access"}
        onOpenChange={(open) => {
          if (!open) setFlow(null);
        }}
        title="在其他设备上使用"
        description="为你信任的设备授权。撤销后，该设备将无法继续访问。"
      >
        {deviceId && <Devices current={deviceId} />}
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setFlow(null)}>
            完成
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={flow === "backup"}
        onOpenChange={(open) => {
          if (!open) setFlow(null);
        }}
        title="数据与备份"
        description="管理运行在这台电脑上的 Domos 数据。"
      >
        <DataBackup />
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setFlow(null)}>
            关闭
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
