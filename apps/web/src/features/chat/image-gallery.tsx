import type { Attachment } from "@domos/agent/attachments";
import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { useEffect, useRef, useState } from "react";
import { chatCopy } from "./copy.ts";

export function ImageGallery({
  botId,
  files,
  onDownload,
  downloading,
  error,
}: {
  botId: number;
  files: Attachment[];
  onDownload: (file: Attachment) => void;
  downloading: boolean;
  error?: string;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const trigger = useRef<HTMLButtonElement>(null);
  const file = selected === null ? undefined : files[selected];
  function move(offset: number) {
    setSelected((index) =>
      index === null ? null : (index + offset + files.length) % files.length,
    );
  }
  useEffect(() => {
    if (selected === null || files.length < 2) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const offset = event.key === "ArrowRight" ? 1 : -1;
      setSelected((index) =>
        index === null ? null : (index + offset + files.length) % files.length,
      );
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [selected, files.length]);
  const alert = error && (
    <p role="alert" className="alert">
      {error}
    </p>
  );
  function image(file: Attachment, lazy: boolean) {
    return failed.has(file.id) ? (
      <span className="image-unavailable">{chatCopy.imageUnavailable}</span>
    ) : (
      <img
        src={`/files/${botId}/${file.id}`}
        alt={file.name}
        loading={lazy ? "lazy" : "eager"}
        onError={() => setFailed((current) => new Set(current).add(file.id))}
      />
    );
  }
  return (
    <>
      <fieldset
        className="image-gallery"
        aria-label={chatCopy.gallery}
        data-count={files.length}
      >
        {files.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className="image-thumbnail"
            aria-label={`${chatCopy.viewImage} ${item.name}`}
            onClick={(event) => {
              trigger.current = event.currentTarget;
              setSelected(index);
            }}
          >
            {image(item, true)}
          </button>
        ))}
      </fieldset>
      {!file && alert}
      <Dialog
        open={Boolean(file)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        finalFocus={() => trigger.current}
        title={file?.name}
        className="image-viewer"
        footer={
          file && (
            <>
              <div className="image-viewer-toolbar">
                <div className="image-viewer-navigation">
                  {files.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon-small"
                      aria-label={chatCopy.previousImage}
                      onClick={() => move(-1)}
                    >
                      <CaretLeftIcon />
                    </Button>
                  )}
                  <span aria-live="polite">
                    {(selected ?? 0) + 1} / {files.length}
                  </span>
                  {files.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon-small"
                      aria-label={chatCopy.nextImage}
                      onClick={() => move(1)}
                    >
                      <CaretRightIcon />
                    </Button>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon-small"
                  aria-label={`${chatCopy.download} ${file.name}`}
                  title={chatCopy.download}
                  disabled={downloading}
                  onClick={() => onDownload(file)}
                >
                  <DownloadSimpleIcon />
                </Button>
              </div>
              {file.source && (
                <p className="image-details">
                  <time dateTime={file.source.capturedAt}>
                    {new Date(file.source.capturedAt).toLocaleString()}
                  </time>
                  {file.source.url && (
                    <>
                      {" "}
                      ·{" "}
                      <a
                        href={file.source.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {chatCopy.imageSource}
                      </a>
                    </>
                  )}
                </p>
              )}
              {alert}
            </>
          )
        }
      >
        {file && (
          <div className="image-viewer-content">{image(file, false)}</div>
        )}
      </Dialog>
    </>
  );
}
