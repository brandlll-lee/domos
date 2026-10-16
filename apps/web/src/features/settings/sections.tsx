import { SettingRow } from "@domos/ui/setting-row";
import { CpuIcon } from "@phosphor-icons/react/dist/csr/Cpu";
import { DesktopIcon } from "@phosphor-icons/react/dist/csr/Desktop";
import { HardDrivesIcon } from "@phosphor-icons/react/dist/csr/HardDrives";
import { PaletteIcon } from "@phosphor-icons/react/dist/csr/Palette";
import { ShieldCheckIcon } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import type { ReactNode } from "react";
import { AppearancePicker } from "../appearance/picker.tsx";
import { ComputerSettings } from "../computer/settings.tsx";
import { DesktopSettings } from "../hosting/desktop.tsx";
import { Devices } from "../hosting/devices.tsx";
import { HostingModels } from "../hosting/models.tsx";

export type SettingsAccess = {
  admin: boolean;
  deviceId?: string;
  standalone: boolean;
};
type SectionProps = SettingsAccess & {
  botId?: number;
  onConfigured: () => void;
};

export const sections = {
  appearance: {
    label: "外观",
    description: "调整主题，选择浅色、深色或跟随系统的显示方式。",
    icon: PaletteIcon,
    render: () => (
      <div className="settings-card">
        <SettingRow title="主题" description="选择适合当前环境的显示方式。">
          <AppearancePicker />
        </SettingRow>
      </div>
    ),
  },
  models: {
    label: "模型",
    description: "连接模型账号，管理提供方和 Bot 使用的模型。",
    icon: CpuIcon,
    render: ({ admin, standalone, botId, onConfigured }: SectionProps) =>
      admin && !standalone ? (
        <HostingModels botId={botId} onConfigured={onConfigured} />
      ) : (
        <p className="detail-note">
          请让管理员连接模型。已连接的模型可在 Bot 详情中选择。
        </p>
      ),
  },
  computers: {
    label: "电脑",
    description: "管理工作电脑、Docker 容器和 Bot 的工具授权。",
    icon: DesktopIcon,
    render: ({ admin }: SectionProps) => <ComputerSettings admin={admin} />,
  },
  devices: {
    label: "设备",
    description: "配对其他设备，管理访问权限和已连接的设备。",
    icon: ShieldCheckIcon,
    render: ({ admin, deviceId }: SectionProps) =>
      admin && deviceId ? (
        <Devices current={deviceId} />
      ) : (
        <p className="detail-note">请让管理员管理设备。</p>
      ),
  },
  instance: {
    label: "实例",
    description: "连接与管理 Domos 实例，创建加密备份或恢复数据。",
    icon: HardDrivesIcon,
    render: () => <DesktopSettings />,
  },
} satisfies Record<
  string,
  {
    label: string;
    description: string;
    icon: typeof PaletteIcon;
    render: (props: SectionProps) => ReactNode;
  }
>;

export type SettingsSection = keyof typeof sections;
export const defaultSection: SettingsSection = "appearance";
