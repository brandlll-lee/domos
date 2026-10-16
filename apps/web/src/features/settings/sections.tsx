import { SettingRow } from "@domos/ui/setting-row";
import { CpuIcon } from "@phosphor-icons/react/dist/csr/Cpu";
import { DesktopIcon } from "@phosphor-icons/react/dist/csr/Desktop";
import { HardDrivesIcon } from "@phosphor-icons/react/dist/csr/HardDrives";
import { PaletteIcon } from "@phosphor-icons/react/dist/csr/Palette";
import { ShieldCheckIcon } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { AppearancePicker } from "../appearance/picker.tsx";
import { ComputerSettings } from "../computer/settings.tsx";
import { DesktopSettings } from "../hosting/desktop.tsx";
import { Devices } from "../hosting/devices.tsx";
import { HostingModels } from "../hosting/models.tsx";
import type { SettingsSection } from "./context.ts";

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
    icon: PaletteIcon,
    render: () => (
      <SettingRow title="主题" description="选择适合当前环境的显示方式。">
        <AppearancePicker />
      </SettingRow>
    ),
  },
  models: {
    label: "模型",
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
    icon: DesktopIcon,
    render: ({ admin }: SectionProps) => <ComputerSettings admin={admin} />,
  },
  devices: {
    label: "设备",
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
    icon: HardDrivesIcon,
    render: () => <DesktopSettings />,
  },
} satisfies Record<
  SettingsSection,
  {
    label: string;
    icon: typeof PaletteIcon;
    render: (props: SectionProps) => React.ReactNode;
  }
>;
