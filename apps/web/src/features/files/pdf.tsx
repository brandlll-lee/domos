import { Button } from "@domos/ui/controls";
import { Loading } from "@domos/ui/loading";
import { useEffect, useRef, useState } from "react";
import "pdfjs-dist/web/pdf_viewer.css";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { fileSummary } from "./file-state.ts";

export default function PdfPreview({
  source,
  botId,
  fileId,
}: {
  source: string;
  botId?: number;
  fileId?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRef<
    import("pdfjs-dist/web/pdf_viewer.mjs").PDFViewer | null
  >(null);
  const [state, setState] = useState({ page: 1, total: 0, error: "" });
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
            !fileId ||
            !event.source.canvas
          )
            return;
          const store = fileSummary(botId, fileId);
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
      if (botId !== undefined && fileId) {
        const store = fileSummary(botId, fileId);
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
  }, [source, botId, fileId]);
  return (
    <div className="file-pdf">
      {state.error ? (
        <p role="alert">{state.error}</p>
      ) : (
        <>
          <div className="file-toolbar" role="toolbar" aria-label="PDF 工具">
            <Button
              variant="ghost"
              size="small"
              disabled={state.page <= 1}
              onClick={() => {
                if (viewer.current) viewer.current.currentPageNumber--;
              }}
            >
              上一页
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
              size="small"
              disabled={state.page >= state.total}
              onClick={() => {
                if (viewer.current) viewer.current.currentPageNumber++;
              }}
            >
              下一页
            </Button>
            <Button
              variant="ghost"
              size="small"
              aria-label="缩小"
              onClick={() => viewer.current?.decreaseScale()}
            >
              −
            </Button>
            <Button
              variant="ghost"
              size="small"
              aria-label="放大"
              onClick={() => viewer.current?.increaseScale()}
            >
              +
            </Button>
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
