import type { Attachment } from "@domos/agent/attachments";
import { Button } from "@domos/ui/controls";
import { PanelDialog } from "@domos/ui/dialog";
import { Loading } from "@domos/ui/loading";
import { ScrollArea } from "@domos/ui/scroll-area";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { ArrowsInSimpleIcon } from "@phosphor-icons/react/dist/csr/ArrowsInSimple";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { MagnifyingGlassPlusIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlassPlus";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { chatCopy } from "./copy.ts";
export function ImageGallery({
  botId,
  files,
  onDownload,
  downloading,
  error,
  caption,
}: {
  botId: number;
  files: Attachment[];
  onDownload: (file: Attachment) => void;
  downloading: boolean;
  error?: string;
  caption?: string;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const trigger = useRef<HTMLButtonElement>(null);
  const file = selected === null ? undefined : files[selected];
  const [rotation, setRotation] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const fullImage = useRef<HTMLImageElement>(null);
  const activeThumbnail = useRef<HTMLButtonElement>(null);
  function select(index: number) {
    if (index === selected) return;
    setSelected(index);
    setRotation(0);
    setZoomed(false);
    setSize({ width: 0, height: 0 });
  }
  function move(offset: number) {
    select(((selected ?? 0) + offset + files.length) % files.length);
  }
  useEffect(() => {
    if (selected === null) return;
    activeThumbnail.current?.scrollIntoView({
      block: "nearest",
      inline: "center",
    });
  }, [selected]);
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
        decoding="async"
        ref={lazy ? undefined : fullImage}
        onLoad={
          lazy
            ? undefined
            : async (event) => {
                const element = event.currentTarget;
                try {
                  await element.decode();
                } catch {
                  if (fullImage.current === element) {
                    setFailed((current) => new Set(current).add(file.id));
                  }
                  return;
                }
                if (fullImage.current !== element) return;
                setSize({
                  width: element.naturalWidth,
                  height: element.naturalHeight,
                });
              }
        }
        onError={() => {
          setFailed((current) => new Set(current).add(file.id));
        }}
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
            data-file-id={item.id}
            aria-label={`${chatCopy.viewImage} ${item.name}`}
            onClick={(event) => {
              trigger.current = event.currentTarget;
              select(index);
              setOpen(true);
            }}
          >
            {image(item, true)}
          </button>
        ))}
      </fieldset>
      {!file && alert}
      <PanelDialog.Root
        open={open}
        onOpenChange={setOpen}
        onOpenChangeComplete={(next) => {
          if (!next) setSelected(null);
        }}
      >
        <PanelDialog.Portal>
          <PanelDialog.Backdrop className="image-viewer-backdrop" />
          <PanelDialog.Popup
            className="image-viewer"
            finalFocus={() => trigger.current}
            onKeyDown={(event) => {
              if (files.length < 2) return;
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                move(event.key === "ArrowRight" ? 1 : -1);
              }
            }}
          >
            {file && (
              <>
                <header className="image-viewer-header">
                  <div className="image-viewer-info">
                    <PanelDialog.Title>{file.name}</PanelDialog.Title>
                    <span aria-live="polite">
                      {(selected ?? 0) + 1} / {files.length}
                    </span>
                  </div>
                  <PanelDialog.Close
                    aria-label="关闭弹窗"
                    title="关闭"
                    render={<Button variant="ghost" size="icon" />}
                  >
                    <XIcon />
                  </PanelDialog.Close>
                </header>
                <div className="image-viewer-main">
                  {files.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="image-viewer-previous"
                      aria-label={chatCopy.previousImage}
                      onClick={() => move(-1)}
                    >
                      <CaretLeftIcon />
                    </Button>
                  )}
                  <div className="image-viewer-stage" key={file.id}>
                    <div
                      className="image-viewer-canvas"
                      data-ready={size.width > 0}
                      data-zoomed={zoomed}
                      data-turned={rotation % 180 !== 0}
                      style={
                        {
                          "--image-rotation": `${rotation}deg`,
                          "--image-width": `${size.width}px`,
                          "--image-height": `${size.height}px`,
                          "--image-frame-width": `${rotation % 180 ? size.height : size.width}px`,
                          "--image-frame-height": `${rotation % 180 ? size.width : size.height}px`,
                        } as CSSProperties
                      }
                    >
                      {image(file, false)}
                      {!size.width && !failed.has(file.id) && (
                        <Loading label="正在加载图片…" />
                      )}
                    </div>
                  </div>
                  {files.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="image-viewer-next"
                      aria-label={chatCopy.nextImage}
                      onClick={() => move(1)}
                    >
                      <CaretRightIcon />
                    </Button>
                  )}
                </div>
                <footer className="image-viewer-footer">
                  <div
                    className="image-viewer-toolbar"
                    role="toolbar"
                    aria-label="图片工具"
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="适应窗口"
                      title="适应窗口"
                      aria-pressed={!zoomed}
                      disabled={failed.has(file.id)}
                      onClick={() => setZoomed(false)}
                    >
                      <ArrowsInSimpleIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="原始尺寸"
                      title="原始尺寸"
                      aria-pressed={zoomed}
                      disabled={failed.has(file.id)}
                      onClick={() => setZoomed(true)}
                    >
                      <MagnifyingGlassPlusIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="旋转图片"
                      title="旋转图片"
                      disabled={failed.has(file.id)}
                      onClick={() => setRotation((angle) => (angle + 90) % 360)}
                    >
                      <ArrowClockwiseIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${chatCopy.download} ${file.name}`}
                      title={chatCopy.download}
                      disabled={downloading}
                      onClick={() => onDownload(file)}
                    >
                      <DownloadSimpleIcon />
                    </Button>
                  </div>
                  {caption && <p className="image-viewer-caption">{caption}</p>}
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
                  {files.length > 1 && (
                    <ScrollArea
                      className="image-viewer-strip"
                      orientation="horizontal"
                    >
                      <nav
                        className="image-viewer-thumbnails"
                        aria-label="图片缩略图"
                      >
                        {files.map((item, index) => (
                          <button
                            type="button"
                            key={item.id}
                            ref={
                              index === selected ? activeThumbnail : undefined
                            }
                            aria-label={`${chatCopy.viewImage} ${item.name}`}
                            aria-current={
                              index === selected ? "true" : undefined
                            }
                            onClick={() => select(index)}
                          >
                            <img
                              src={`/files/${botId}/${item.id}`}
                              alt=""
                              loading="lazy"
                            />
                          </button>
                        ))}
                      </nav>
                    </ScrollArea>
                  )}
                </footer>
              </>
            )}
          </PanelDialog.Popup>
        </PanelDialog.Portal>
      </PanelDialog.Root>
    </>
  );
}
