import { Button } from "@domos/ui/controls";
import { useEffect, useRef, useState } from "react";
import "pdfjs-dist/web/pdf_viewer.css";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export default function PdfPreview({ blob }: { blob: Blob }) {
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
        data: new Uint8Array(await blob.arrayBuffer()),
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
      const document = await task.promise;
      if (!active) return;
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
  }, [blob]);
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
              {state.total ? `${state.page} / ${state.total}` : "正在读取 PDF…"}
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
