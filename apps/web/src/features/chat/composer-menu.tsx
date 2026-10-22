import type { InputMaterials } from "@domos/agent/materials";
import type { ChatMessage } from "@domos/agent/messages";
import { Button } from "@domos/ui/controls";
import { Popover } from "@domos/ui/popover";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { FileIcon } from "@phosphor-icons/react/dist/csr/File";
import { ImageIcon } from "@phosphor-icons/react/dist/csr/Image";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { QuotesIcon } from "@phosphor-icons/react/dist/csr/Quotes";
import { SparkleIcon } from "@phosphor-icons/react/dist/csr/Sparkle";
import { TextAlignLeftIcon } from "@phosphor-icons/react/dist/csr/TextAlignLeft";
import { useEffect, useRef, useState } from "react";
import { MessagePicker, SkillPicker, TextPicker } from "./material-picker.tsx";
import "./composer-menu.css";

const titles = {
  menu: "添加内容",
  skills: "使用技能",
  context: "添加上下文",
  text: "粘贴文本",
  messages: "引用消息",
};

export function ComposerMenu({
  botId,
  disabled,
  filesDisabled,
  messages,
  onFiles,
  materials,
  onMaterials,
}: {
  botId: number;
  disabled: boolean;
  filesDisabled: boolean;
  messages: ChatMessage[];
  onFiles: (images: boolean) => void;
  materials: InputMaterials;
  onMaterials: (materials: InputMaterials) => void;
}) {
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<keyof typeof titles>("menu");
  useEffect(() => {
    if (open)
      popup.current
        ?.querySelector<HTMLElement>(
          panel === "text"
            ? "textarea"
            : panel === "skills" || panel === "messages"
              ? "input"
              : "[role=menuitem]",
        )
        ?.focus();
  }, [open, panel]);
  function skill(value: InputMaterials["skills"][number]) {
    onMaterials({
      ...materials,
      skills: [
        ...materials.skills.filter((item) => item.id !== value.id),
        value,
      ],
    });
    setOpen(false);
  }
  function context(value: InputMaterials["context"][number]) {
    onMaterials({ ...materials, context: [...materials.context, value] });
    setOpen(false);
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
            className="composer-menu-popup"
            data-panel={panel}
            aria-label={titles[panel]}
          >
            {panel !== "menu" && (
              <header className="composer-picker-head">
                <Button
                  variant="ghost"
                  size="icon-small"
                  aria-label="返回添加菜单"
                  onClick={() =>
                    setPanel(
                      panel === "text" || panel === "messages"
                        ? "context"
                        : "menu",
                    )
                  }
                >
                  <ArrowLeftIcon />
                </Button>
                <Popover.Title>{titles[panel]}</Popover.Title>
              </header>
            )}
            {panel === "menu" || panel === "context" ? (
              <div
                role="menu"
                aria-label={titles[panel]}
                onKeyDown={(event) => {
                  const elements = [
                    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                      "button:not(:disabled)",
                    ),
                  ];
                  const index = elements.indexOf(
                    document.activeElement as HTMLButtonElement,
                  );
                  const target =
                    event.key === "ArrowDown"
                      ? elements[(index + 1) % elements.length]
                      : event.key === "ArrowUp"
                        ? elements[
                            (index - 1 + elements.length) % elements.length
                          ]
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
                      <ImageIcon />
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
                      <FileIcon />
                      添加文件
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="composer-menu-item"
                      disabled={materials.skills.length >= 10}
                      onClick={() => setPanel("skills")}
                    >
                      <SparkleIcon />
                      使用技能…
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="composer-menu-item"
                      disabled={materials.context.length >= 10}
                      onClick={() => setPanel("context")}
                    >
                      <QuotesIcon />
                      添加上下文…
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      className="composer-menu-item"
                      onClick={() => setPanel("text")}
                    >
                      <TextAlignLeftIcon />
                      粘贴文本
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="composer-menu-item"
                      onClick={() => setPanel("messages")}
                    >
                      <QuotesIcon />
                      引用消息
                    </button>
                  </>
                )}
              </div>
            ) : panel === "skills" ? (
              <SkillPicker botId={botId} onSelect={skill} />
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
