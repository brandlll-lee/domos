import type { Attachment } from "@domos/agent/attachments";
import { filePreviewKind } from "@domos/agent/attachments";
import { Button } from "@domos/ui/controls";
import { Loading } from "@domos/ui/loading";
import { PanelHeader } from "@domos/ui/panel";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { useState } from "react";
import { ImageGallery } from "../chat/image-gallery.tsx";
import { fileAction } from "./actions.ts";
import { FileContent } from "./content.tsx";
import { useFilePreview } from "./context.tsx";
import { useFile } from "./use-file.ts";
import "./style.css";

export function FilePanel({
  botId,
  file,
  onBack,
  onClose,
  onTarget,
}: {
  botId: number;
  file: Attachment;
  onBack: () => void;
  onClose: () => void;
  onTarget: (target: HTMLElement | null) => void;
}) {
  const kind = filePreviewKind(file);
  const buffered = ["text", "markdown", "csv", "html", "image"].includes(kind);
  const data = useFile(botId, file, buffered);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  async function action(value: "save" | "open" | "reveal") {
    setError(undefined);
    setPending(true);
    try {
      await fileAction(botId, file, value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作未完成。");
    } finally {
      setPending(false);
    }
  }
  const preview = useFilePreview();
  const inline = preview?.inline.has(file.id);
  return (
    <aside className="file-panel" aria-label="文件预览">
      <PanelHeader
        title={file.name}
        onBack={onBack}
        onClose={onClose}
        actions={
          <>
            <Button
              variant="ghost"
              size="icon-small"
              aria-label="下载文件"
              disabled={pending}
              onClick={() => void action("save")}
            >
              <DownloadSimpleIcon />
            </Button>
            {window.domosDesktop && (
              <>
                <Button
                  variant="ghost"
                  size="icon-small"
                  aria-label="系统打开"
                  title="系统打开本地副本"
                  disabled={pending}
                  onClick={() => void action("open")}
                >
                  <ArrowSquareOutIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-small"
                  aria-label="文件位置"
                  title="显示本地副本"
                  disabled={pending}
                  onClick={() => void action("reveal")}
                >
                  <FolderOpenIcon />
                </Button>
              </>
            )}
          </>
        }
      />
      <div className="file-panel-content">
        {error && <p role="alert">{error}</p>}
        {inline ? (
          <div className="file-inline-target" ref={onTarget} />
        ) : kind === "image" ? (
          <ImageGallery
            botId={botId}
            files={[file]}
            downloading={pending}
            onDownload={() => void action("save")}
          />
        ) : (
          (!buffered || data.blob) && (
            <FileContent
              key={file.id}
              botId={botId}
              file={file}
              blob={data.blob}
            />
          )
        )}
        {!inline && data.error && (
          <p role="alert">
            {data.error}
            <Button variant="ghost" size="small" onClick={data.retry}>
              重试
            </Button>
          </p>
        )}
        {!inline && buffered && !data.blob && !data.error && (
          <Loading label="正在打开文件" />
        )}
      </div>
    </aside>
  );
}
