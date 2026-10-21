import { CpuIcon } from "@phosphor-icons/react/dist/csr/Cpu";
import { DesktopIcon } from "@phosphor-icons/react/dist/csr/Desktop";
import { GearIcon } from "@phosphor-icons/react/dist/csr/Gear";
import type { ReactNode } from "react";
import { ComputerSettings } from "../computer/settings.tsx";
import { GeneralSettings } from "./general.tsx";
import { ModelSettings } from "./models.tsx";
import { ProviderSettings } from "./providers.tsx";

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
    primary: true,
    label: "通用",
    description: "主题、设备访问与数据管理。",
    icon: GearIcon,
    render: (props: SectionProps) => <GeneralSettings {...props} />,
  },
  providers: {
    primary: true,
    label: "Providers",
    description: "管理 Harness 和模型提供方的连接。",
    icon: CpuIcon,
    render: ({ admin, standalone, botId }: SectionProps) =>
      admin && !standalone ? (
        <ProviderSettings botId={botId} />
      ) : (
        <p className="detail-note">请让管理员连接模型账号。</p>
      ),
  },
  models: {
    primary: true,
    label: "Models",
    description: "管理可用模型在聊天选择器中的可见性。",
    icon: CpuIcon,
    render: ({ admin, botId }: SectionProps) => (
      <ModelSettings botId={botId} admin={admin} />
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
