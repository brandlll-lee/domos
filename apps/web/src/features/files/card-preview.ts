import { type Attachment, filePreviewKind } from "@domos/agent/attachments";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { fileUrl } from "./actions.ts";
import type { FileSummary } from "./file-state.ts";

export async function readCardPreview(
  botId: number,
  file: Attachment,
  signal: AbortSignal,
): Promise<FileSummary> {
  signal.throwIfAborted();
  const kind = filePreviewKind(file);
  if (kind === "image") {
    const response = await fetch(`/files/${botId}/${file.id}/preview`, {
      signal,
    });
    if (!response.ok) throw new Error("无法读取图片缩略图。");
    return response.json();
  }
  if (kind === "pdf") {
    const pdfjs = await import("pdfjs-dist");
    signal.throwIfAborted();
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const task = pdfjs.getDocument({
      url: fileUrl(botId, file.id),
      disableAutoFetch: true,
      disableStream: true,
      cMapUrl: "/pdf/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdf/standard_fonts/",
      wasmUrl: "/pdf/wasm/",
    });
    const cancel = () => void task.destroy();
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const pdf = await task.promise;
      const page = await pdf.getPage(1);
      const original = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 320 / original.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      signal.throwIfAborted();
      return { pages: pdf.numPages, thumbnail: canvas.toDataURL("image/webp") };
    } finally {
      signal.removeEventListener("abort", cancel);
      await task.destroy();
    }
  }
  if (kind !== "video" && kind !== "audio") return {};
  return new Promise((resolve, reject) => {
    const media = document.createElement(kind);
    const finish = (error?: unknown, data?: FileSummary) => {
      media.onloadedmetadata = null;
      media.onloadeddata = null;
      media.onerror = null;
      signal.removeEventListener("abort", cancel);
      media.removeAttribute("src");
      media.load();
      if (error) reject(error);
      else resolve(data ?? {});
    };
    const cancel = () => finish(signal.reason);
    signal.addEventListener("abort", cancel, { once: true });
    media.muted = true;
    media.preload = kind === "audio" ? "metadata" : "auto";
    media.onerror = () => finish(new Error("无法读取媒体预览。"));
    media.onloadedmetadata = () => {
      if (kind === "audio") finish(undefined, { duration: media.duration });
    };
    media.onloadeddata = () => {
      if (!(media instanceof HTMLVideoElement)) return;
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(640, media.videoWidth);
      canvas.height = Math.round(
        (media.videoHeight * canvas.width) / media.videoWidth,
      );
      canvas
        .getContext("2d")
        ?.drawImage(media, 0, 0, canvas.width, canvas.height);
      finish(undefined, {
        duration: media.duration,
        thumbnail: canvas.toDataURL("image/webp"),
      });
    };
    media.src = fileUrl(botId, file.id);
  });
}
