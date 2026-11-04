import type { Attachment } from "@domos/agent/attachments";
import { filePreviewKind } from "@domos/agent/attachments";
import { Button } from "@domos/ui/controls";
import { PanelHeader } from "@domos/ui/panel";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { ImageGallery } from "../chat/image-gallery.tsx";
import { FileContent } from "./content.tsx";
import { useFilePreview } from "./context.tsx";
import { downloadFile, useFile } from "./use-file.ts";
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
  const data = useFile(botId, file);
  const preview = useFilePreview();
  const inline = preview?.inline.has(file.id);
  return (
    <aside className="file-panel" aria-label="文件预览">
      <PanelHeader
        title={file.name}
        onBack={onBack}
        onClose={onClose}
        actions={
          <Button
            variant="ghost"
            size="icon-small"
            aria-label="下载文件"
            disabled={!data.blob}
            onClick={() => {
              if (data.blob) downloadFile(data.blob, file.name);
            }}
          >
            <DownloadSimpleIcon />
          </Button>
        }
      />
      <div className="file-panel-content">
        {inline ? (
          <div className="file-inline-target" ref={onTarget} />
        ) : (
          data.blob &&
          (filePreviewKind({ ...file, mimeType: data.blob.type }) ===
          "image" ? (
            <ImageGallery
              botId={botId}
              files={[file]}
              downloading={false}
              onDownload={() => {
                if (data.blob) downloadFile(data.blob, file.name);
              }}
            />
          ) : (
            <FileContent key={file.id} file={file} blob={data.blob} />
          ))
        )}
        {!inline && data.error && (
          <p role="alert">
            {data.error}
            <Button variant="ghost" size="small" onClick={data.retry}>
              重试
            </Button>
          </p>
        )}
        {!inline && !data.blob && !data.error && (
          <p role="status">正在打开文件…</p>
        )}
      </div>
    </aside>
  );
}
