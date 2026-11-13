import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { SettingRow } from "@domos/ui/setting-row";
import { useState } from "react";
import { AppearancePicker } from "../appearance/picker.tsx";
import { DataBackup } from "../hosting/backup.tsx";
import type { SettingsAccess } from "./sections.tsx";

export function GeneralSettings({ admin }: SettingsAccess) {
  const [flow, setFlow] = useState(false);
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
      {admin && window.domosDesktop && (
        <section className="settings-group">
          <h3>管理</h3>
          <div className="settings-card">
            <SettingRow
              title="数据与备份"
              description="创建加密备份，或从备份恢复。"
            >
              <Button
                variant="secondary"
                size="small"
                onClick={() => setFlow(true)}
              >
                管理备份
              </Button>
            </SettingRow>
          </div>
        </section>
      )}
      <Dialog
        open={flow}
        onOpenChange={setFlow}
        title="数据与备份"
        description="管理运行在这台电脑上的 Domos 数据。"
        footer={
          <div className="dialog-actions">
            <Button variant="secondary" onClick={() => setFlow(false)}>
              关闭
            </Button>
          </div>
        }
      >
        <DataBackup />
      </Dialog>
    </div>
  );
}
