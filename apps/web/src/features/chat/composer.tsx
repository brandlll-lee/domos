import { MAX_ATTACHMENTS } from "@domos/agent/attachments";
import type { Bot } from "@domos/agent/bots";
import type { PrivateConversation } from "@domos/agent/conversations";
import { FileAttachment } from "@domos/ui/attachment";
import { MessageComposer } from "@domos/ui/composer";
import { Button } from "@domos/ui/controls";
import { Popover } from "@domos/ui/popover";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { FileMdIcon } from "@phosphor-icons/react/dist/csr/FileMd";
import { FilePdfIcon } from "@phosphor-icons/react/dist/csr/FilePdf";
import { FileTextIcon } from "@phosphor-icons/react/dist/csr/FileText";
import { MicrophoneIcon } from "@phosphor-icons/react/dist/csr/Microphone";
import { StopIcon } from "@phosphor-icons/react/dist/csr/Stop";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { type ReactNode, type Ref, useRef, useState } from "react";
import { useErrorNotice } from "../notices.tsx";
import { BotPicker } from "./bot-reference.tsx";
import { ComposerMenu } from "./composer-menu.tsx";
import { chatCopy } from "./copy.ts";
import { materialTokens } from "./material-tokens.tsx";
import { type SendMessage, useComposer } from "./use-composer.ts";
import type { useDraft } from "./use-draft.ts";
import { useUploads } from "./use-uploads.ts";

export function Composer({
  ref,
  inputRef,
  draft,
  conversations = [],
  botName,
  members = [],
  conversationId,
  connected,
  busy,
  sending,
  stopping,
  onSend,
  onStop,
  status,
  computerReady = true,
  onComputerRequired,
}: {
  ref: Ref<HTMLElement>;
  inputRef: Ref<HTMLDivElement>;
  draft: ReturnType<typeof useDraft>;
  conversations?: PrivateConversation[];
  botName: string;
  members?: Bot[];
  conversationId: number;
  connected: boolean;
  busy: boolean;
  sending: boolean;
  stopping: boolean;
  onSend: SendMessage;
  onStop: () => Promise<void>;
  status?: ReactNode;
  computerReady?: boolean;
  onComputerRequired?: () => void;
}) {
  const [mention, setMention] = useState<{
    start: number;
    end: number;
    query: string;
  }>();
  const input = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const mentionMenu = useRef<HTMLDivElement>(null);
  const setEditor = (node: HTMLDivElement | null) => {
    editor.current = node;
    if (typeof inputRef === "function") inputRef(node);
    else if (inputRef) inputRef.current = node;
  };
  const uploads = useUploads(conversationId, draft.draft.attachments, (file) =>
    draft.update({
      attachments: [
        ...draft.current.current.attachments.filter(
          (item) => item.id !== file.id,
        ),
        file,
      ],
    }),
  );
  const composer = useComposer(
    draft,
    draft.ready && connected && !stopping && !sending && !uploads.items.length,
    onSend,
  );
  useErrorNotice(uploads.error ?? composer.error);
  const hasMaterials = Boolean(
    composer.materials.skills.length ||
      composer.materials.context.length ||
      composer.materials.mcp?.length ||
      composer.materials.bots?.length,
  );
  const hasContent = Boolean(
    composer.value.trim() ||
      composer.attachments.length ||
      composer.pending ||
      hasMaterials,
  );
  const kind = hasContent ? "send" : busy ? "stop" : "voice";
  const stopAction = kind === "stop";
  const action = stopAction
    ? {
        label: stopping ? chatCopy.stopping : chatCopy.stop,
        disabled: stopping || !connected,
      }
    : {
        label:
          kind === "voice"
            ? chatCopy.voice
            : sending
              ? chatCopy.sending
              : composer.pending
                ? chatCopy.retry
                : chatCopy.send,
        disabled:
          !hasContent ||
          !draft.ready ||
          !connected ||
          sending ||
          stopping ||
          uploads.items.length > 0,
      };
  function selectBot(bot: Bot) {
    const start = mention?.start ?? composer.caret.current;
    const end = mention?.end ?? start;
    const current = draft.current.current;
    const all = materialTokens(current.materials)
      .filter((token) => token.position !== undefined)
      .toSorted((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const shift = <T extends { position?: number }>(item: T) => ({
      ...item,
      ...(item.position !== undefined && item.position >= end
        ? {
            position: item.position - (end - start) + 1,
          }
        : {}),
    });
    const textOffset = (position: number) =>
      position - all.filter((token) => (token.position ?? 0) < position).length;
    draft.update({
      text:
        current.text.slice(0, textOffset(start)) +
        current.text.slice(textOffset(end)),
      materials: {
        skills: current.materials.skills.map(shift),
        context: current.materials.context.map(shift),
        mcp: current.materials.mcp?.map(shift),
        bots: [
          ...(current.materials.bots ?? []).map(shift),
          {
            id: crypto.randomUUID(),
            botId: bot.id,
            name: bot.name,
            avatar: bot.avatar,
            position: start,
          },
        ],
      },
    });

    composer.moveCaret(start + 1);
    setMention(undefined);
    requestAnimationFrame(() => editor.current?.focus());
  }
  return (
    <footer ref={ref} className="composer-area">
      {status}
      <input
        ref={input}
        hidden
        type="file"
        multiple
        aria-label={chatCopy.upload}
        onChange={(event) => {
          if (event.target.files) uploads.add(event.target.files);
          event.target.value = "";
        }}
      />
      <Popover.Root
        open={Boolean(mention && members?.length)}
        onOpenChange={(open) => {
          if (!open) setMention(undefined);
        }}
      >
        <Popover.Portal>
          <Popover.Positioner
            anchor={editor}
            side="top"
            align="start"
            sideOffset={8}
          >
            <Popover.Popup
              ref={mentionMenu}
              initialFocus={false}
              finalFocus={false}
              className="popover-surface composer-menu-popup bot-mention-menu"
              aria-label="选择 Bot"
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const buttons = [
                    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                      "button",
                    ),
                  ];
                  const at = buttons.indexOf(
                    document.activeElement as HTMLButtonElement,
                  );
                  buttons[
                    (at +
                      (event.key === "ArrowDown" ? 1 : buttons.length - 1)) %
                      buttons.length
                  ]?.focus();
                }
              }}
            >
              <BotPicker
                bots={members}
                query={mention?.query}
                onSelect={selectBot}
              />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      <MessageComposer
        ref={setEditor}
        value={composer.value}
        onValueChange={(text, caret, positions) => {
          composer.change(text, caret, positions);
          const offset =
            caret - positions.filter((token) => token.position < caret).length;
          const match = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, offset));
          setMention(
            members?.length && match
              ? {
                  start: caret - (match[1] ?? "").length - 1,
                  end: caret,
                  query: match[1] ?? "",
                }
              : undefined,
          );
        }}
        onCaretChange={composer.moveCaret}
        onKeyDown={(event) => {
          if (!mention) return;
          if (event.key === "Escape") {
            event.preventDefault();
            setMention(undefined);
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const buttons =
              mentionMenu.current?.querySelectorAll<HTMLButtonElement>(
                "button",
              );
            (event.key === "ArrowDown"
              ? buttons?.[0]
              : buttons?.[buttons.length - 1]
            )?.focus();
          } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            mentionMenu.current
              ?.querySelector<HTMLButtonElement>("button")
              ?.click();
          }
        }}
        tokens={materialTokens(composer.materials).map((token, index) => ({
          ...token,
          position: token.position ?? composer.value.length + index,
        }))}
        onSubmit={() => void composer.submit()}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files).filter((file) =>
            file.type.startsWith("image/"),
          );
          if (!files.length) return;
          event.preventDefault();
          if (!draft.ready || !connected || composer.pending) return;
          if (!computerReady) {
            onComputerRequired?.();
            return;
          }
          uploads.add(files);
        }}
        label={chatCopy.message}
        placeholder={chatCopy.placeholder(botName)}
        leading={
          <ComposerMenu
            botId={conversationId}
            members={members}
            onBot={selectBot}
            disabled={!draft.ready || !connected || composer.pending}
            filesDisabled={
              uploads.busy || composer.attachments.length >= MAX_ATTACHMENTS
            }
            conversations={conversations}
            materials={composer.materials}
            onMaterials={composer.setMaterials}
            insertionPosition={() => composer.caret.current}
            onInsert={() =>
              requestAnimationFrame(() => editor.current?.focus())
            }
            onFiles={() => {
              if (!computerReady) {
                onComputerRequired?.();
                return;
              }
              if (input.current) {
                input.current.accept = "";
                input.current.click();
              }
            }}
          />
        }
        attachments={
          composer.attachments.length || uploads.items.length ? (
            <>
              {uploads.items.map((item) => (
                <div className="composer-upload" key={item.id}>
                  <div className="composer-upload-caption">
                    <strong title={item.file.name}>{item.file.name}</strong>
                    <span role={item.status === "failed" ? "alert" : "status"}>
                      {item.status === "failed" ? item.error : "正在上传…"}
                    </span>
                  </div>
                  {item.status === "failed" && (
                    <Button
                      variant="ghost"
                      size="small"
                      onClick={() => uploads.retry(item.id)}
                    >
                      重试
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-small"
                    aria-label={`取消上传 ${item.file.name}`}
                    onClick={() => uploads.cancel(item.id)}
                  >
                    <XIcon />
                  </Button>
                </div>
              ))}
              {composer.attachments.map((file) => {
                const type =
                  file.mimeType === "application/pdf"
                    ? "PDF"
                    : file.name.split(".").slice(1).pop()?.toUpperCase() ||
                      "文件";
                const Icon =
                  type === "PDF"
                    ? FilePdfIcon
                    : type === "MD"
                      ? FileMdIcon
                      : FileTextIcon;
                return (
                  <FileAttachment
                    key={file.id}
                    name={file.name}
                    size={file.size}
                    type={type}
                    icon={<Icon weight="duotone" />}
                    preview={
                      !file.mimeType || file.mimeType.startsWith("image/")
                        ? `/files/${conversationId}/${file.id}`
                        : undefined
                    }
                    action={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-small"
                        aria-label={`${chatCopy.removeFile} ${file.name}`}
                        disabled={composer.pending}
                        onClick={() =>
                          void uploads.remove(file.id, () =>
                            composer.remove(file.id),
                          )
                        }
                      >
                        <XIcon />
                      </Button>
                    }
                  />
                );
              })}
            </>
          ) : null
        }
        action={
          <Button
            type={stopAction ? "button" : "submit"}
            size="icon"
            data-action={kind}
            title={action.label}
            aria-label={action.label}
            disabled={action.disabled}
            onClick={stopAction ? () => void onStop() : undefined}
          >
            {stopAction ? (
              <StopIcon weight="fill" />
            ) : kind === "voice" ? (
              <MicrophoneIcon weight="fill" />
            ) : (
              <ArrowUpIcon />
            )}
          </Button>
        }
      />
    </footer>
  );
}
