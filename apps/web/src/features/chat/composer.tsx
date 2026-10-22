import { MAX_ATTACHMENTS } from "@domos/agent/attachments";
import type { ChatMessage } from "@domos/agent/messages";
import { FileAttachment } from "@domos/ui/attachment";
import { MessageComposer } from "@domos/ui/composer";
import { Button } from "@domos/ui/controls";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { FileMdIcon } from "@phosphor-icons/react/dist/csr/FileMd";
import { FilePdfIcon } from "@phosphor-icons/react/dist/csr/FilePdf";
import { FileTextIcon } from "@phosphor-icons/react/dist/csr/FileText";
import { StopIcon } from "@phosphor-icons/react/dist/csr/Stop";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { type ReactNode, type Ref, useRef } from "react";
import { ComposerMenu } from "./composer-menu.tsx";
import { chatCopy } from "./copy.ts";
import { MaterialChips } from "./material-chips.tsx";
import { type SendMessage, useComposer } from "./use-composer.ts";
import type { useDraft } from "./use-draft.ts";
import { useUploads } from "./use-uploads.ts";

export function Composer({
  ref,
  inputRef,
  draft,
  messages,
  botName,
  conversationId,
  connected,
  busy,
  sending,
  stopping,
  error,
  onSend,
  onStop,
  status,
  computerReady = true,
  onComputerRequired,
}: {
  ref: Ref<HTMLElement>;
  inputRef: Ref<HTMLTextAreaElement>;
  draft: ReturnType<typeof useDraft>;
  messages: ChatMessage[];
  botName: string;
  conversationId: number;
  connected: boolean;
  busy: boolean;
  sending: boolean;
  stopping: boolean;
  error: string | null;
  onSend: SendMessage;
  onStop: () => Promise<void>;
  status?: ReactNode;
  computerReady?: boolean;
  onComputerRequired?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const uploads = useUploads(
    conversationId,
    draft.draft.attachments.length,
    (file) =>
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
    connected && !stopping && !sending && !uploads.items.length,
    onSend,
  );
  const issue = uploads.error ?? error ?? composer.error;
  const hasMaterials = Boolean(
    composer.materials.skills.length || composer.materials.context.length,
  );
  const stopAction =
    busy &&
    !composer.value.trim() &&
    !composer.attachments.length &&
    !composer.pending &&
    !hasMaterials;
  const action = stopAction
    ? {
        label: stopping ? chatCopy.stopping : chatCopy.stop,
        disabled: stopping || !connected,
      }
    : {
        label: sending
          ? chatCopy.sending
          : composer.pending
            ? chatCopy.retry
            : chatCopy.send,
        disabled:
          (!composer.value.trim() &&
            !composer.pending &&
            !composer.attachments.length &&
            !hasMaterials) ||
          !connected ||
          sending ||
          stopping ||
          uploads.items.length > 0,
      };
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
      {issue && (
        <p className="alert" role="alert">
          {issue}
        </p>
      )}
      <MessageComposer
        ref={inputRef}
        value={composer.value}
        onValueChange={composer.change}
        onSubmit={() => void composer.submit()}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files).filter((file) =>
            file.type.startsWith("image/"),
          );
          if (!files.length) return;
          event.preventDefault();
          if (!connected || composer.pending) return;
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
            disabled={!connected || composer.pending}
            filesDisabled={
              uploads.busy || composer.attachments.length >= MAX_ATTACHMENTS
            }
            messages={messages}
            materials={composer.materials}
            onMaterials={composer.setMaterials}
            onFiles={(images) => {
              if (!computerReady) {
                onComputerRequired?.();
                return;
              }
              if (input.current) {
                input.current.accept = images
                  ? "image/png,image/jpeg,image/webp,image/gif"
                  : "";
                input.current.click();
              }
            }}
          />
        }
        attachments={
          composer.attachments.length ||
          uploads.items.length ||
          hasMaterials ? (
            <>
              <MaterialChips
                materials={composer.materials}
                disabled={composer.pending}
                onChange={composer.setMaterials}
              />
              {uploads.items.map((item) => (
                <div className="composer-upload" key={item.id}>
                  <div className="composer-upload-caption">
                    <strong title={item.file.name}>{item.file.name}</strong>
                    <span role={item.status === "failed" ? "alert" : "status"}>
                      {item.status === "failed"
                        ? item.error
                        : item.cancelled
                          ? "正在取消…"
                          : "正在上传…"}
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
                    disabled={item.cancelled}
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
            title={action.label}
            aria-label={action.label}
            disabled={action.disabled}
            onClick={stopAction ? () => void onStop() : undefined}
          >
            {stopAction ? <StopIcon weight="fill" /> : <ArrowUpIcon />}
          </Button>
        }
      />
    </footer>
  );
}
