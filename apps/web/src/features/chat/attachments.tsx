import type { Attachment } from "@domos/agent/attachments";
import { FileAttachment } from "@domos/ui/attachment";
import { Button } from "@domos/ui/controls";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { useState } from "react";
import { client } from "../../client.ts";
import { chatCopy } from "./copy.ts";

export function Attachments({
  botId,
  files,
}: {
  botId: number;
  files: Attachment[];
}) {
  const [error, setError] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  async function download(file: Attachment) {
    setDownloading(file.id);
    setError(false);
    try {
      const blob = await client.files.download({ botId, id: file.id });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError(true);
    } finally {
      setDownloading(null);
    }
  }
  return (
    <div className="attachments">
      {files.map((file) => (
        <FileAttachment
          key={file.id}
          name={file.name}
          size={file.size}
          preview={
            !file.mimeType || file.mimeType.startsWith("image/")
              ? `/files/${botId}/${file.id}`
              : undefined
          }
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
      ))}
      {error && (
        <p role="alert" className="alert">
          {chatCopy.errors.download}
        </p>
      )}
    </div>
  );
}
