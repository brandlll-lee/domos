import { type Attachment, filePreviewKind } from "@domos/agent/attachments";
import {
  AudioAttachment,
  FileAttachment,
  VideoAttachment,
} from "@domos/ui/attachment";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { ActionMenu } from "@domos/ui/menu";
import { UserIcon } from "@phosphor-icons/react/dist/csr/User";
import { useState } from "react";
import { fileAction, fileUrl } from "../files/actions.ts";
import { InlineFile } from "../files/content.tsx";
import { useFilePreview } from "../files/context.tsx";
import { fileIcon } from "../files/file-icon.ts";
import { useFileSummary } from "../files/use-file-summary.ts";
import { chatCopy } from "./copy.ts";
import { ImageGallery } from "./image-gallery.tsx";

export function Attachments({
  botId,
  files,
  caption,
  inline = false,
  author,
}: {
  botId: number;
  files: Attachment[];
  caption?: string;
  inline?: boolean;
  author?: "user" | { name: string; avatar: string };
}) {
  const [error, setError] = useState(false);
  const preview = useFilePreview();
  const [downloading, setDownloading] = useState<string | null>(null);
  const images = files.filter((file) => file.mimeType?.startsWith("image/"));
  const documents = files.filter(
    (file) => !file.mimeType?.startsWith("image/"),
  );
  async function download(file: Attachment) {
    setDownloading(file.id);
    setError(false);
    try {
      await fileAction(botId, file, "save");
    } catch {
      setError(true);
    } finally {
      setDownloading(null);
    }
  }
  return (
    <div className="attachments">
      {images.length > 0 && (
        <ImageGallery
          botId={botId}
          files={images}
          caption={caption}
          onDownload={(file) => void download(file)}
          downloading={downloading !== null}
          error={error ? chatCopy.errors.download : undefined}
        />
      )}
      {documents.map((file) => (
        <div key={file.id}>
          {inline && file.display === "inline" && (
            <InlineFile botId={botId} file={file} />
          )}
          <AttachmentCard
            botId={botId}
            file={file}
            author={author}
            onOpen={() => preview?.open(file, botId)}
          />
        </div>
      ))}
      {error && images.length === 0 && (
        <p role="alert" className="alert">
          {chatCopy.errors.download}
        </p>
      )}
    </div>
  );
}

function AttachmentCard({
  botId,
  file,
  onOpen,
  author,
}: {
  botId: number;
  file: Attachment;
  onOpen: () => void;
  author?: "user" | { name: string; avatar: string };
}) {
  const { element, summary } = useFileSummary(botId, file);
  const kind = filePreviewKind(file);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function action(value: "save" | "open" | "reveal") {
    setPending(true);
    setError(undefined);
    try {
      await fileAction(botId, file, value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "文件操作未完成。");
    } finally {
      setPending(false);
    }
  }
  const Icon = fileIcon(file);
  const details = summary?.pages
    ? `${summary.pages} 页`
    : summary?.sheets
      ? `${summary.sheets} 个工作表`
      : undefined;
  const menu = (
    <ActionMenu
      label={`更多文件操作 ${file.name}`}
      disabled={pending}
      items={[
        ...(kind === "audio" ? [{ label: "查看详情", onSelect: onOpen }] : []),
        ...(["audio", "video"].includes(kind)
          ? [{ label: "另存为…", onSelect: () => void action("save") }]
          : []),
        ...(window.domosDesktop
          ? [
              {
                label: "系统打开本地副本",
                onSelect: () => void action("open"),
              },
              {
                label: "显示本地副本位置",
                onSelect: () => void action("reveal"),
              },
            ]
          : []),
      ]}
    />
  );
  return (
    <div ref={element} className="message-attachment">
      {kind === "audio" ? (
        <AudioAttachment
          name={file.name}
          src={fileUrl(botId, file.id)}
          duration={summary?.duration}
          avatar={
            author === "user" ? (
              <UserIcon aria-label="你" />
            ) : (
              author && (
                <span title={author.name}>
                  <BotAvatar seed={author.avatar} />
                </span>
              )
            )
          }
          action={menu}
        />
      ) : kind === "video" ? (
        <VideoAttachment
          name={file.name}
          thumbnail={summary?.thumbnail}
          duration={summary?.duration}
          onOpen={onOpen}
          action={menu}
        />
      ) : (
        <FileAttachment
          name={file.name}
          size={file.size}
          icon={<Icon weight="duotone" />}
          type={file.name.split(".").at(-1)?.toUpperCase()}
          details={details}
          thumbnail={summary?.thumbnail}
          onOpen={onOpen}
          action={window.domosDesktop ? menu : undefined}
          footer={
            <>
              <Button variant="ghost" size="small" onClick={onOpen}>
                查看
              </Button>
              <Button
                variant="ghost"
                size="small"
                pending={pending}
                aria-label={`另存为 ${file.name}`}
                onClick={() => void action("save")}
              >
                另存为…
              </Button>
            </>
          }
        />
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
