import { MAX_ATTACHMENTS, MAX_FILE_BYTES } from "@domos/agent/attachments";
import { FileAttachment } from "@domos/ui/attachment";
import { MessageComposer } from "@domos/ui/composer";
import { Button } from "@domos/ui/controls";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { PaperclipIcon } from "@phosphor-icons/react/dist/csr/Paperclip";
import { StopIcon } from "@phosphor-icons/react/dist/csr/Stop";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { type ReactNode, useRef, useState } from "react";
import { client } from "../../client.ts";
import { chatCopy } from "./copy.ts";
import { type SendMessage, useComposer } from "./use-composer.ts";

export function Composer({
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
}: {
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
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const composer = useComposer(
    conversationId,
    connected && !busy && !sending && !uploading,
    onSend,
  );
  const issue = uploadError ?? error ?? composer.error;
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setUploadError(null);
    try {
      if (composer.attachments.length + files.length > MAX_ATTACHMENTS)
        throw new Error("File limit");
      for (const file of files) {
        if (file.size > MAX_FILE_BYTES) throw new Error("File size");
        const attachment = await client.files.upload({
          botId: conversationId,
          file,
        });
        composer.attach(attachment);
      }
    } catch {
      setUploadError(chatCopy.errors.upload);
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }
  const action = busy
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
            !composer.attachments.length) ||
          !connected ||
          sending ||
          uploading,
      };
  return (
    <footer className="composer-area">
      {status}
      <input
        ref={input}
        hidden
        type="file"
        multiple
        aria-label={chatCopy.upload}
        onChange={(event) => void upload(event.target.files)}
      />
      {uploading && (
        <p className="working" role="status">
          {chatCopy.uploading}
        </p>
      )}
      {issue && (
        <p className="alert" role="alert">
          {issue}
        </p>
      )}
      <MessageComposer
        value={composer.value}
        onValueChange={composer.change}
        onSubmit={() => void composer.submit()}
        label={chatCopy.message}
        placeholder={chatCopy.placeholder(botName)}
        leading={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title={chatCopy.upload}
            aria-label={chatCopy.upload}
            disabled={
              !connected ||
              uploading ||
              composer.pending ||
              composer.attachments.length >= MAX_ATTACHMENTS
            }
            onClick={() => input.current?.click()}
          >
            <PaperclipIcon />
          </Button>
        }
        attachments={
          composer.attachments.length
            ? composer.attachments.map((file) => (
                <FileAttachment
                  key={file.id}
                  name={file.name}
                  size={file.size}
                  preview={
                    !file.mimeType || file.mimeType.startsWith("image/")
                      ? `/files/${conversationId}/${file.id}`
                      : undefined
                  }
                  action={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`${chatCopy.removeFile} ${file.name}`}
                      disabled={composer.pending}
                      onClick={() => composer.remove(file.id)}
                    >
                      <XIcon />
                    </Button>
                  }
                />
              ))
            : null
        }
        action={
          <Button
            type={busy ? "button" : "submit"}
            size="icon"
            title={action.label}
            aria-label={action.label}
            disabled={action.disabled}
            onClick={busy ? () => void onStop() : undefined}
          >
            {busy ? <StopIcon weight="fill" /> : <ArrowUpIcon />}
          </Button>
        }
      />
    </footer>
  );
}
