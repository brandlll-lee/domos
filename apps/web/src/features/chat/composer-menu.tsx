import type { Bot } from "@domos/agent/bots";
import { type InputMaterials, MAX_MATERIALS } from "@domos/agent/materials";
import type { ChatMessage } from "@domos/agent/messages";
import { Button } from "@domos/ui/controls";
import { Popover } from "@domos/ui/popover";
import { ChatCircleIcon } from "@phosphor-icons/react/dist/csr/ChatCircle";
import { FolderSimpleIcon } from "@phosphor-icons/react/dist/csr/FolderSimple";
import { HammerIcon } from "@phosphor-icons/react/dist/csr/Hammer";
import { ImageIcon } from "@phosphor-icons/react/dist/csr/Image";
import { PaperclipIcon } from "@phosphor-icons/react/dist/csr/Paperclip";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { QuotesIcon } from "@phosphor-icons/react/dist/csr/Quotes";
import { TextAlignLeftIcon } from "@phosphor-icons/react/dist/csr/TextAlignLeft";
import { UsersIcon } from "@phosphor-icons/react/dist/csr/Users";
import { useEffect, useRef, useState } from "react";
import {
  McpPicker,
  MessagePicker,
  SkillPicker,
  TextPicker,
} from "./material-picker.tsx";
import "./composer-menu.css";
import { BotPicker } from "./bot-reference.tsx";

const titles = {
  menu: "添加内容",
  skills: "技能",
  mcp: "MCP",
  context: "上下文",
  text: "粘贴文本",
  messages: "引用消息",
  bots: "选择 Bot",
};

export function ComposerMenu({
  botId,
  disabled,
  filesDisabled,
  messages,
  onFiles,
  materials,
  onMaterials,
  insertionPosition,
  onInsert,
  members,
  onBot,
}: {
  botId: number;
  disabled: boolean;
  filesDisabled: boolean;
  messages: ChatMessage[];
  onFiles: (images: boolean) => void;
  materials: InputMaterials;
  onMaterials: (materials: InputMaterials) => void;
  insertionPosition: () => number;
  onInsert: () => void;
  members: Bot[];
  onBot: (bot: Bot) => void;
}) {
  const popup = useRef<HTMLDivElement>(null);
  const returnTarget = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<keyof typeof titles>("menu");
  useEffect(() => {
    if (open) {
      const target = returnTarget.current
        ? `[data-panel-target="${returnTarget.current}"]`
        : panel === "text"
          ? "textarea"
          : "button:not(:disabled)";
      (
        popup.current?.querySelector<HTMLElement>(target) ?? popup.current
      )?.focus();
      returnTarget.current = null;
    }
  }, [open, panel]);
  function insertAt(position: number) {
    const shift = <T extends { position?: number }>(item: T): T => ({
      ...item,
      ...(item.position !== undefined && item.position >= position
        ? { position: item.position + 1 }
        : {}),
    });
    return {
      bots: materials.bots?.map(shift),
      skills: materials.skills.map(shift),
      mcp: materials.mcp?.map(shift),
      context: materials.context.map(shift),
    };
  }
  function skill(value: InputMaterials["skills"][number]) {
    const existing = materials.skills.find((item) => item.id === value.id);
    const position = existing?.position ?? insertionPosition();
    const next = existing ? materials : insertAt(position);
    onMaterials({
      ...next,
      skills: [
        ...next.skills.filter((item) => item.id !== value.id),
        { ...value, position },
      ],
    });
    setOpen(false);
    onInsert();
  }
  function mcp(value: NonNullable<InputMaterials["mcp"]>[number]) {
    const existing = materials.mcp?.find((item) => item.id === value.id);
    const position = existing?.position ?? insertionPosition();
    const next = existing ? materials : insertAt(position);
    onMaterials({
      ...next,
      mcp: [
        ...(next.mcp ?? []).filter((item) => item.id !== value.id),
        { ...value, position },
      ],
    });
    setOpen(false);
    onInsert();
  }
  function context(value: InputMaterials["context"][number]) {
    const position = insertionPosition();
    const next = insertAt(position);
    onMaterials({
      ...next,
      context: [...next.context, { ...value, position }],
    });
    setOpen(false);
    onInsert();
  }
  return (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) setPanel("menu");
      }}
    >
      <Popover.Trigger
        render={
          <Button
            type="button"
            variant="secondary"
            size="icon"
            title="添加内容"
            aria-label="添加内容"
            disabled={disabled}
          />
        }
      >
        <PlusIcon />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="composer-menu-positioner"
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
        >
          <Popover.Popup
            ref={popup}
            className="popover-surface composer-menu-popup"
            data-panel={panel}
            aria-label={titles[panel]}
            onKeyDownCapture={(event) => {
              if (event.key === "Escape" && panel !== "menu") {
                event.preventDefault();
                event.stopPropagation();
                returnTarget.current = panel;
                setPanel(
                  panel === "text" || panel === "messages" ? "context" : "menu",
                );
              }
            }}
            onKeyDown={(event) => {
              if (!(event.target instanceof HTMLButtonElement)) return;
              const elements = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "button:not(:disabled)",
                ),
              ];
              const index = elements.indexOf(event.target);
              const target =
                event.key === "ArrowDown"
                  ? elements[(index + 1) % elements.length]
                  : event.key === "ArrowUp"
                    ? elements[(index - 1 + elements.length) % elements.length]
                    : event.key === "Home"
                      ? elements[0]
                      : event.key === "End"
                        ? elements.at(-1)
                        : null;
              if (target) {
                event.preventDefault();
                target.focus();
              }
            }}
          >
            {panel !== "menu" && (
              <header className="composer-picker-head">
                <Popover.Title>{titles[panel]}</Popover.Title>
              </header>
            )}
            {panel === "menu" || panel === "context" ? (
              <div role="menu" aria-label={titles[panel]}>
                {panel === "menu" ? (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      className="composer-menu-item"
                      disabled={filesDisabled}
                      onClick={() => {
                        setOpen(false);
                        onFiles(true);
                      }}
                    >
                      <ImageIcon weight="light" />
                      添加图片
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="composer-menu-item"
                      disabled={filesDisabled}
                      onClick={() => {
                        setOpen(false);
                        onFiles(false);
                      }}
                    >
                      <PaperclipIcon weight="light" />
                      添加文件
                    </button>
                    <hr className="composer-menu-separator" />
                    <button
                      type="button"
                      role="menuitem"
                      className="composer-menu-item"
                      data-panel-target="bots"
                      onClick={() => setPanel("bots")}
                    >
                      <UsersIcon weight="light" />
                      选择 Bot…
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="composer-menu-item"
                      disabled={materials.skills.length >= MAX_MATERIALS}
                      data-panel-target="skills"
                      onClick={() => setPanel("skills")}
                    >
                      <FolderSimpleIcon weight="light" />
                      使用技能…
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="composer-menu-item"
                      disabled={materials.context.length >= MAX_MATERIALS}
                      data-panel-target="context"
                      onClick={() => setPanel("context")}
                    >
                      <ChatCircleIcon weight="light" />
                      添加上下文…
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="composer-menu-item"
                      disabled={(materials.mcp?.length ?? 0) >= MAX_MATERIALS}
                      data-panel-target="mcp"
                      onClick={() => setPanel("mcp")}
                    >
                      <HammerIcon weight="light" />
                      引用 MCP…
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      className="composer-menu-item"
                      data-panel-target="text"
                      onClick={() => setPanel("text")}
                    >
                      <TextAlignLeftIcon weight="light" />
                      粘贴文本
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="composer-menu-item"
                      data-panel-target="messages"
                      onClick={() => setPanel("messages")}
                    >
                      <QuotesIcon weight="light" />
                      引用消息
                    </button>
                  </>
                )}
              </div>
            ) : panel === "bots" ? (
              <BotPicker
                bots={members}
                onSelect={(bot) => {
                  setOpen(false);
                  onBot(bot);
                }}
              />
            ) : panel === "skills" ? (
              <SkillPicker botId={botId} onSelect={skill} />
            ) : panel === "mcp" ? (
              <McpPicker botId={botId} onSelect={mcp} />
            ) : panel === "text" ? (
              <TextPicker botId={botId} onSelect={context} />
            ) : (
              <MessagePicker
                botId={botId}
                messages={messages}
                onSelect={context}
              />
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
