import { CpuIcon } from "@phosphor-icons/react/dist/csr/Cpu";
import { DesktopIcon } from "@phosphor-icons/react/dist/csr/Desktop";
import { GearIcon } from "@phosphor-icons/react/dist/csr/Gear";
import type { ReactNode } from "react";
import { ComputerSettings } from "../computer/settings.tsx";
import { HostingModels } from "../hosting/models.tsx";
import { GeneralSettings } from "./general.tsx";

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
  general: {
    primary: true,
    label: "通用",
    description: "主题、设备访问与数据管理。",
    icon: GearIcon,
    render: (props: SectionProps) => <GeneralSettings {...props} />,
  },
  models: {
    primary: true,
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
    primary: false,
    label: "电脑高级管理",
    description: "管理镜像、SSH、工作路径和容器生命周期。",
    icon: DesktopIcon,
    render: ({ admin }: SectionProps) => <ComputerSettings admin={admin} />,
  },
} satisfies Record<
  string,
  {
    primary: boolean;
    label: string;
    description: string;
    icon: typeof GearIcon;
    render: (props: SectionProps) => ReactNode;
  }
>;

export type SettingsSection = keyof typeof sections;
export const defaultSection: SettingsSection = "general";
