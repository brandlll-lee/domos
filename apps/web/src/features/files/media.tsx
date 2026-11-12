import type { Attachment } from "@domos/agent/attachments";
import { useEffect, useRef, useState } from "react";
import { fileUrl } from "./actions.ts";
import { fileSummary } from "./file-state.ts";

export default function MediaPreview({
  botId,
  file,
  kind,
}: {
  botId: number;
  file: Attachment;
  kind: "audio" | "video";
}) {
  const player = useRef<HTMLMediaElement | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const media = player.current;
    return () => {
      if (media) {
        media.pause();
        media.removeAttribute("src");
        media.load();
      }
    };
  }, []);
  const properties = {
    className: "file-media",
    controls: true,
    preload: "metadata",
    src: fileUrl(botId, file.id),
    "aria-label": file.name,
    onError: () => setError(true),
    onLoadedMetadata: () => {
      const duration = player.current?.duration;
      if (duration !== undefined && Number.isFinite(duration)) {
        const store = fileSummary(botId, file);
        store.receive({ ...store.snapshot().data, duration });
      }
    },
  };
  return (
    <div className="file-media-container">
      {kind === "audio" ? (
        <audio
          {...properties}
          ref={(node) => {
            player.current = node;
          }}
        />
      ) : (
        <video
          {...properties}
          ref={(node) => {
            player.current = node;
          }}
        />
      )}
      {error && (
        <p role="alert">
          此文件的编码无法在当前播放器中播放。请另存为或使用系统打开。
        </p>
      )}
    </div>
  );
}
