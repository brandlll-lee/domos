import { DesktopIcon } from "@phosphor-icons/react/dist/csr/Desktop";
import { GearIcon } from "@phosphor-icons/react/dist/csr/Gear";
import { SparkleIcon } from "@phosphor-icons/react/dist/csr/Sparkle";
import type { ReactNode } from "react";
import { ComputerSettings } from "../computer/settings.tsx";
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
    primary: true,
    label: "通用",
    description: "主题、设备访问与数据管理。",
    icon: GearIcon,
    render: (props: SectionProps) => <GeneralSettings {...props} />,
  },
  ai: {
    primary: true,
    label: "AI 服务",
    description: "管理服务连接和可用模型。",
    icon: SparkleIcon,
    render: ({ admin, botId }: SectionProps) => (
      <AISettings botId={botId} admin={admin} />
    ),
  },
  computers: {
    primary: false,
    label: "电脑",
    description: "",
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
