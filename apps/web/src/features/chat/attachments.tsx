import { type Attachment, filePreviewKind } from "@domos/agent/attachments";
import { FileAttachment } from "@domos/ui/attachment";
import { Button } from "@domos/ui/controls";
import { ActionMenu } from "@domos/ui/menu";
import { FileMdIcon } from "@phosphor-icons/react/dist/csr/FileMd";
import { FilePdfIcon } from "@phosphor-icons/react/dist/csr/FilePdf";
import { FileTextIcon } from "@phosphor-icons/react/dist/csr/FileText";
import { useState, useSyncExternalStore } from "react";
import { fileAction } from "../files/actions.ts";
import { InlineFile } from "../files/content.tsx";
import { useFilePreview } from "../files/context.tsx";
import { fileSummary } from "../files/file-state.ts";
import { chatCopy } from "./copy.ts";
import { ImageGallery } from "./image-gallery.tsx";

export function Attachments({
  botId,
  files,
  caption,
  inline = false,
}: {
  botId: number;
  files: Attachment[];
  caption?: string;
  inline?: boolean;
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
          <DocumentCard
            botId={botId}
            file={file}
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

function DocumentCard({
  botId,
  file,
  onOpen,
}: {
  botId: number;
  file: Attachment;
  onOpen: () => void;
}) {
  const store = fileSummary(botId, file.id);
  const summary = useSyncExternalStore(store.subscribe, store.snapshot).data;
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
  const kind = filePreviewKind(file);
  const Icon =
    kind === "pdf"
      ? FilePdfIcon
      : kind === "markdown"
        ? FileMdIcon
        : FileTextIcon;
  const duration = summary?.duration;
  const details = summary?.pages
    ? `${summary.pages} ${kind === "office" && /\.pptx?$/i.test(file.name) ? "张幻灯片" : "页"}`
    : summary?.sheets
      ? `${summary.sheets} 个工作表`
      : duration !== undefined
        ? `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, "0")}`
        : undefined;
  return (
    <>
      <FileAttachment
        name={file.name}
        size={file.size}
        icon={<Icon weight="duotone" />}
        type={file.name.split(".").at(-1)?.toUpperCase()}
        details={details}
        thumbnail={summary?.thumbnail}
        onOpen={onOpen}
        action={
          window.domosDesktop && (
            <ActionMenu
              label={`更多文件操作 ${file.name}`}
              disabled={pending}
              items={[
                {
                  label: "系统打开本地副本",
                  onSelect: () => void action("open"),
                },
                {
                  label: "显示本地副本位置",
                  onSelect: () => void action("reveal"),
                },
              ]}
            />
          )
        }
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
      {error && <p role="alert">{error}</p>}
    </>
  );
}
