import type { Attachment } from "@domos/agent/attachments";
import { FileAttachment } from "@domos/ui/attachment";
import { Button } from "@domos/ui/controls";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { useState } from "react";
import { InlineFile } from "../files/content.tsx";
import { useFilePreview } from "../files/context.tsx";
import { fileState } from "../files/file-state.ts";
import { downloadFile } from "../files/use-file.ts";
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
      const store = fileState(botId, file.id);
      const blob = await store.load(Boolean(store.snapshot().error));
      downloadFile(blob, file.name);
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
          <FileAttachment
            name={file.name}
            size={file.size}
            onOpen={() => preview?.open(file, botId)}
            action={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`${chatCopy.download} ${file.name}`}
                title={chatCopy.download}
                disabled={downloading !== null}
                onClick={() => void download(file)}
              >
                <DownloadSimpleIcon />
              </Button>
            }
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
