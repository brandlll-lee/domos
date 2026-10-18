import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { SettingsContext } from "./context.ts";
import { SettingsPage } from "./page.tsx";
import {
  defaultSection,
  type SettingsAccess,
  type SettingsSection,
} from "./sections.tsx";
import "./style.css";

export function SettingsRoot({
  children,
  ...access
}: SettingsAccess & { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState(defaultSection);
  const [botId, setBotId] = useState<number>();
  const [discard, setDiscard] = useState(false);
  const [message, setMessage] = useState("");
  const content = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const frame = useRef<number>(undefined);
  useEffect(() => () => cancelAnimationFrame(frame.current ?? 0), []);

  function returnTarget() {
    return (
      [
        opener.current,
        document.getElementById("settings-trigger"),
        document.getElementById("contacts-trigger"),
      ].find((element) => element?.checkVisibility()) ?? null
    );
  }
  function finish() {
    setDiscard(false);
    setOpen(false);
    frame.current = requestAnimationFrame(() => returnTarget()?.focus());
  }
  function close() {
    if (content.current?.querySelector('[aria-busy="true"]')) {
      setMessage("正在保存。请等待操作完成。");
      return;
    }
    if (content.current?.querySelector('[data-dirty="true"]')) {
      setDiscard(true);
      return;
    }
    finish();
  }
  function show(next: SettingsSection = defaultSection, target?: number) {
    cancelAnimationFrame(frame.current ?? 0);
    opener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setSection(next);
    setBotId(target);
    setMessage("");
    setOpen(true);
  }
  return (
    <SettingsContext
      value={{
        admin: access.admin,
        standalone: access.standalone,
        open: show,
        page: open ? (
          <SettingsPage
            {...access}
            initialSection={section}
            onSectionChange={setSection}
            botId={botId}
            contentRef={content}
            message={message}
            onBack={close}
            onConfigured={finish}
          />
        ) : null,
      }}
    >
      {children}
      <Dialog
        open={discard}
        onOpenChange={setDiscard}
        title="放弃未保存的配置？"
        description="已保存的连接不受影响。"
        finalFocus={() =>
          open ? document.getElementById("settings-back") : returnTarget()
        }
      >
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setDiscard(false)}>
            继续编辑
          </Button>
          <Button onClick={finish}>放弃更改</Button>
        </div>
      </Dialog>
    </SettingsContext>
  );
}
