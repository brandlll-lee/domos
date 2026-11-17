import type { Attachment } from "@domos/agent/attachments";
import { Button } from "@domos/ui/controls";
import { Loading } from "@domos/ui/loading";
import { InlineNotice } from "@domos/ui/message";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import viewerStyles from "pdfjs-dist/web/pdf_viewer.css?inline";
import { useEffect, useRef, useState } from "react";
import { fileSummary } from "./file-state.ts";

const styles = `@scope (.file-pdf) { ${viewerStyles.replaceAll(":root", ":scope")} :scope { color-scheme: inherit; } }`;

export default function PdfPreview({
  source,
  botId,
  file,
}: {
  source: string;
  botId?: number;
  file?: Attachment;
}) {
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRef<
    import("pdfjs-dist/web/pdf_viewer.mjs").PDFViewer | null
  >(null);
  const [state, setState] = useState({ page: 1, total: 0, error: "" });
  const [scale, setScale] = useState(1);
  useEffect(() => {
    let active = true;
    let destroy = () => {};
    void (async () => {
      const pdfjs = await import("pdfjs-dist");
      if (!active || !container.current) return;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      const { PDFViewer, EventBus } = await import(
        "pdfjs-dist/web/pdf_viewer.mjs"
      );
      if (!active || !container.current) return;
      const bus = new EventBus();
      const instance = new PDFViewer({
        container: container.current,
        eventBus: bus,
        annotationMode: 0,
      });
      viewer.current = instance;
      let width = container.current.clientWidth;
      let frame = 0;
      const resize = new ResizeObserver(() => {
        const next = container.current?.clientWidth;
        if (next === width) return;
        width = next ?? 0;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          if (instance.currentScaleValue === "page-width")
            instance.currentScaleValue = "page-width";
        });
      });
      resize.observe(container.current);
      const task = pdfjs.getDocument({
        url: source,
        disableAutoFetch: true,
        disableStream: true,
        cMapUrl: "/pdf/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: "/pdf/standard_fonts/",
        wasmUrl: "/pdf/wasm/",
      });
      destroy = () => {
        resize.disconnect();
        cancelAnimationFrame(frame);
        instance.setDocument(null);
        instance.cleanup();
        void task.destroy();
        viewer.current = null;
      };
      if (!active) {
        destroy();
        return;
      }
      bus.on("pagesinit", () => {
        if (active) instance.currentScaleValue = "page-width";
      });
      bus.on("pagechanging", (event: { pageNumber: number }) => {
        if (active) setState((state) => ({ ...state, page: event.pageNumber }));
      });
      bus.on("scalechanging", (event: { scale: number }) => {
        if (active) setScale(event.scale);
      });
      bus.on(
        "pagerendered",
        (event: {
          pageNumber: number;
          source: { canvas?: HTMLCanvasElement };
        }) => {
          if (
            !active ||
            event.pageNumber !== 1 ||
            botId === undefined ||
            !file ||
            !event.source.canvas
          )
            return;
          const store = fileSummary(botId, file);
          if (store.snapshot().data?.thumbnail) return;
          const original = event.source.canvas;
          const thumbnail = window.document.createElement("canvas");
          thumbnail.width = 320;
          thumbnail.height = Math.round(
            (original.height * thumbnail.width) / original.width,
          );
          thumbnail
            .getContext("2d")
            ?.drawImage(original, 0, 0, thumbnail.width, thumbnail.height);
          store.receive({
            ...store.snapshot().data,
            thumbnail: thumbnail.toDataURL("image/webp", 0.7),
          });
        },
      );
      const document = await task.promise;
      if (!active) return;
      if (botId !== undefined && file) {
        const store = fileSummary(botId, file);
        store.receive({ ...store.snapshot().data, pages: document.numPages });
      }
      setState({ page: 1, total: document.numPages, error: "" });
      instance.setDocument(document);
    })().catch(() => {
      if (active)
        setState({
          page: 1,
          total: 0,
          error: "PDF 无法打开，可能已损坏或需要密码。你仍可下载原文件。",
        });
    });
    return () => {
      active = false;
      destroy();
    };
  }, [source, botId, file]);
  return (
    <div className="file-pdf">
      <style>{styles}</style>
      {state.error ? (
        <div className="file-preview-notice" role="alert">
          <InlineNotice>{state.error}</InlineNotice>
        </div>
      ) : (
        <>
          <div className="file-toolbar" role="toolbar" aria-label="PDF 工具">
            <fieldset className="file-toolbar-group" aria-label="翻页">
              <Button
                variant="ghost"
                size="icon-small"
                aria-label="上一页"
                title="上一页"
                disabled={state.page <= 1}
                onClick={() => {
                  if (viewer.current) viewer.current.currentPageNumber--;
                }}
              >
                <CaretLeftIcon />
              </Button>
              <span aria-live="polite">
                {state.total ? (
                  `${state.page} / ${state.total}`
                ) : (
                  <Loading label="正在读取 PDF" inline />
                )}
              </span>
              <Button
                variant="ghost"
                size="icon-small"
                aria-label="下一页"
                title="下一页"
                disabled={state.page >= state.total}
                onClick={() => {
                  if (viewer.current) viewer.current.currentPageNumber++;
                }}
              >
                <CaretRightIcon />
              </Button>
            </fieldset>
            <fieldset className="file-toolbar-group" aria-label="缩放">
              <Button
                variant="ghost"
                size="icon-small"
                aria-label="缩小"
                title="缩小"
                disabled={!state.total}
                onClick={() => viewer.current?.decreaseScale()}
              >
                −
              </Button>
              <Button
                variant="ghost"
                size="small"
                aria-label="适应宽度"
                title="适应宽度"
                disabled={!state.total}
                onClick={() => {
                  if (viewer.current)
                    viewer.current.currentScaleValue = "page-width";
                }}
              >
                {Math.round(scale * 100)}%
              </Button>
              <Button
                variant="ghost"
                size="icon-small"
                aria-label="放大"
                title="放大"
                disabled={!state.total}
                onClick={() => viewer.current?.increaseScale()}
              >
                +
              </Button>
            </fieldset>
          </div>
          <div className="file-pdf-body">
            <div className="file-pdf-scroll" ref={container}>
              <div className="pdfViewer" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
