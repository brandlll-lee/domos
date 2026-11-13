import { DesktopIcon } from "@phosphor-icons/react/dist/csr/Desktop";
import { GearIcon } from "@phosphor-icons/react/dist/csr/Gear";
import { SparkleIcon } from "@phosphor-icons/react/dist/csr/Sparkle";
import type { ReactNode } from "react";
import { ComputerSettings } from "../computer/settings.tsx";
import { Devices } from "../hosting/devices.tsx";
import { AISettings } from "./ai.tsx";
import { GeneralSettings } from "./general.tsx";

export type SettingsAccess = {
  admin: boolean;
  deviceId?: string;
  standalone: boolean;
};
type SectionProps = SettingsAccess & {
  botId?: number;
};

export const sections = {
  general: {
    label: "通用",
    description: "主题与数据管理。",
    icon: GearIcon,
    render: (props: SectionProps) => <GeneralSettings {...props} />,
  },
  ai: {
    label: "AI 服务",
    description: "管理服务连接和可用模型。",
    icon: SparkleIcon,
    render: ({ admin, botId }: SectionProps) => (
      <AISettings botId={botId} admin={admin} />
    ),
  },
  computers: {
    label: "当前电脑",
    description: "名称、设备访问与电脑权限。",
    icon: DesktopIcon,
    render: ({ admin, deviceId }: SectionProps) => (
      <div className="settings-sections">
        <ComputerSettings admin={admin} />
        {admin && deviceId && <Devices current={deviceId} />}
      </div>
    ),
  },
} satisfies Record<
  string,
  {
    label: string;
    description: string;
    icon: typeof GearIcon;
    render: (props: SectionProps) => ReactNode;
  }
>;

export type SettingsSection = keyof typeof sections;
export const defaultSection: SettingsSection = "general";
