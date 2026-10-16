import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { Tabs } from "@domos/ui/tabs";
import { compactChat } from "@domos/ui/tokens";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { type ReactNode, useEffect, useRef, useState } from "react";
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
  const [compact, setCompact] = useState(
    () => matchMedia(`(max-width: ${compactChat.maxWidth})`).matches,
  );
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const media = matchMedia(`(max-width: ${compactChat.maxWidth})`);
    const sync = () => setCompact(media.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
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
        className={`settings-dialog${compact ? " settings-compact" : ""}`}
        finalFocus={() => document.getElementById("settings-trigger")}
      >
        <Tabs.Root
          className="settings-layout"
          data-compact={compact || undefined}
          value={section}
          orientation={compact ? "horizontal" : "vertical"}
          onValueChange={(value) => {
            const next = value as SettingsSection;
            setSection(next);
            setVisited((current) =>
              current.includes(next) ? current : [...current, next],
            );
          }}
        >
          <aside className="settings-sidebar">
            <h2>设置</h2>
            <Tabs.List className="settings-nav" aria-label="设置分区">
              {Object.entries(sections).map(([id, item]) => (
                <Tabs.Tab key={id} value={id}>
                  <item.icon aria-hidden="true" />
                  <span>{item.label}</span>
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </aside>
          <div className="settings-main">
            <header className="settings-header">
              <h2>{sections[section].label}</h2>
              <Button
                variant="ghost"
                size="icon-small"
                aria-label="关闭"
                onClick={close}
              >
                <XIcon />
              </Button>
            </header>
            <div className="settings-content" ref={content}>
              {visited.map((id) => (
                <Tabs.Panel key={id} value={id} keepMounted>
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
