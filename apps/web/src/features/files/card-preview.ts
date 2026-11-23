import { type Attachment, filePreviewKind } from "@domos/agent/attachments";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { fileUrl } from "./actions.ts";
import type { FileSummary } from "./file-state.ts";

async function readAudioWaveform(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("无法读取音频波形。");
  const bytes = await response.arrayBuffer();
  signal.throwIfAborted();
  const decoder = new OfflineAudioContext(1, 1, 8000);
  const audio = await decoder.decodeAudioData(bytes).catch((error: unknown) => {
    if (error instanceof DOMException && error.name === "EncodingError") return;
    throw error;
  });
  signal.throwIfAborted();
  if (!audio) return;
  const channels = Array.from({ length: audio.numberOfChannels }, (_, index) =>
    audio.getChannelData(index),
  );
  const bars = 48;
  const peaks = Array.from({ length: bars }, (_, index) => {
    const start = Math.floor((index * audio.length) / bars);
    const end = Math.floor(((index + 1) * audio.length) / bars);
    let peak = 0;
    for (const channel of channels)
      for (let sample = start; sample < end; sample++)
        peak = Math.max(peak, Math.abs(channel[sample] ?? 0));
    return peak;
  });
  const loudest = Math.max(0.04, ...peaks);
  return peaks.map((peak) => Math.sqrt(peak / loudest));
}

export async function readCardPreview(
  botId: number,
  file: Attachment,
  signal: AbortSignal,
): Promise<FileSummary> {
  signal.throwIfAborted();
  const kind = filePreviewKind(file);
  if (kind === "image") {
    const response = await fetch(
      `/files/${botId}/${file.id}/preview?width=960`,
      {
        signal,
      },
    );
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
  const url = fileUrl(botId, file.id);
  const summary = await new Promise<FileSummary>((resolve, reject) => {
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
    media.src = url;
  });
  if (
    kind === "audio" &&
    file.size <= 8 * 1024 * 1024 &&
    summary.duration !== undefined &&
    summary.duration > 0 &&
    summary.duration <= 300
  )
    summary.waveform = await readAudioWaveform(url, signal);
  return summary;
}
