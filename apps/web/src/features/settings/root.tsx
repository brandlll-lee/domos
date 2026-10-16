import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { Tabs } from "@domos/ui/tabs";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { type ReactNode, useRef, useState } from "react";
import { SettingsContext, type SettingsSection } from "./context.ts";
import { type SettingsAccess, sections } from "./sections.tsx";
import "./style.css";

export function SettingsRoot({
  children,
  ...access
}: SettingsAccess & { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SettingsSection>("appearance");
  const [botId, setBotId] = useState<number>();
  const [visited, setVisited] = useState<SettingsSection[]>([]);
  const [discard, setDiscard] = useState(false);
  const [message, setMessage] = useState("");
  const content = useRef<HTMLDivElement>(null);
  function close() {
    if (content.current?.querySelector('[aria-busy="true"]')) {
      setMessage("正在保存。请等待操作完成。");
      return;
    }
    if (content.current?.querySelector('[data-dirty="true"]')) {
      setDiscard(true);
      return;
    }
    setOpen(false);
  }
  function show(next: SettingsSection = "appearance", target?: number) {
    setSection(next);
    setBotId(target);
    setVisited([next]);
    setMessage("");
    setOpen(true);
  }
  return (
    <SettingsContext value={{ open: show }}>
      {children}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        title="设置"
        description="管理此 Domos 的外观、连接与设备。"
        className="settings-dialog"
        finalFocus={() => document.getElementById("settings-trigger")}
      >
        <Button
          className="settings-close"
          variant="ghost"
          size="icon"
          aria-label="关闭"
          onClick={close}
        >
          <XIcon />
        </Button>
        <Tabs.Root
          className="settings-layout"
          value={section}
          orientation="vertical"
          onValueChange={(value) => {
            const next = value as SettingsSection;
            setSection(next);
            setVisited((current) =>
              current.includes(next) ? current : [...current, next],
            );
          }}
        >
          <Tabs.List className="settings-nav" aria-label="设置分区">
            {Object.entries(sections).map(([id, item]) => (
              <Tabs.Tab key={id} value={id}>
                <item.icon />
                <span>{item.label}</span>
              </Tabs.Tab>
            ))}
          </Tabs.List>
          <div className="settings-content" ref={content}>
            {visited.map((id) => (
              <Tabs.Panel key={id} value={id} keepMounted>
                <h2 className="settings-section-title">{sections[id].label}</h2>
                {sections[id].render({
                  ...access,
                  botId,
                  onConfigured: () => setOpen(false),
                })}
              </Tabs.Panel>
            ))}
            {message && (
              <p role="status" className="detail-note">
                {message}
              </p>
            )}
          </div>
        </Tabs.Root>
        <Dialog
          open={discard}
          onOpenChange={setDiscard}
          title="放弃未保存的配置？"
          description="已保存的连接不受影响。"
        >
          <div className="dialog-actions">
            <Button variant="secondary" onClick={() => setDiscard(false)}>
              继续编辑
            </Button>
            <Button
              onClick={() => {
                setDiscard(false);
                setOpen(false);
              }}
            >
              放弃更改
            </Button>
          </div>
        </Dialog>
      </Dialog>
    </SettingsContext>
  );
}
