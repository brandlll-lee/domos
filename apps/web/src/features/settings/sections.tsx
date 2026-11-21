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
  page?: string;
  onPageChange: (page?: string) => void;
};

export type SettingsSection = "general" | "ai" | "computers";

export const sections: Record<
  SettingsSection,
  {
    label: string;
    description: string;
    icon: typeof GearIcon;
    pages?: Record<string, string>;
    render: (props: SectionProps) => ReactNode;
  }
> = {
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
    description: "",
    icon: DesktopIcon,
    pages: { devices: "设备访问", environments: "工作环境" },
    render: (props: SectionProps) => <ComputerSettings {...props} />,
  },
};

export const defaultSection: SettingsSection = "general";
