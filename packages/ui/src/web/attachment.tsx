import { type ReactNode, useState } from "react";

export function MediaAttachment({
  name,
  kind,
  thumbnail,
  duration,
  onOpen,
  action,
}: {
  name: string;
  kind: "audio" | "video";
  thumbnail?: string;
  duration?: number;
  onOpen: () => void;
  action: ReactNode;
}) {
  const time =
    duration !== undefined && Number.isFinite(duration)
      ? `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, "0")}`
      : undefined;
  return (
    <div className={`media-attachment media-attachment-${kind}`}>
      <button
        type="button"
        className="media-attachment-preview"
        onClick={onOpen}
        aria-label={`预览 ${name}`}
      >
        {kind === "video" && thumbnail && (
          <img src={thumbnail} alt={`${name} 视频封面`} />
        )}
        {kind === "audio" && (
          <svg
            className="media-attachment-icon"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              d="M9 17V5l12-2v12M9 9l12-2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <ellipse cx="6" cy="17" rx="3" ry="2" fill="currentColor" />
            <ellipse cx="18" cy="15" rx="3" ry="2" fill="currentColor" />
          </svg>
        )}
        <span className="media-attachment-play" aria-hidden="true">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m9 5 11 7-11 7Z" fill="currentColor" />
          </svg>
        </span>
        {(kind === "audio" || !thumbnail) && (
          <span className="media-attachment-name" title={name}>
            {name}
          </span>
        )}
        {time && <span className="media-attachment-duration">{time}</span>}
      </button>
      <div className="media-attachment-menu">{action}</div>
    </div>
  );
}

export function FileAttachment({
  name,
  size,
  action,
  preview,
  icon,
  type,
  onOpen,
  footer,
  thumbnail,
  details,
}: {
  name: string;
  size: number;
  action: ReactNode;
  preview?: string;
  icon?: ReactNode;
  type?: string;
  onOpen?: () => void;
  footer?: ReactNode;
  thumbnail?: string;
  details?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (preview && !failed)
    return (
      <div className="attachment attachment-image">
        <a
          className="attachment-preview"
          href={preview}
          target="_blank"
          rel="noreferrer"
        >
          <img src={preview} alt={name} onError={() => setFailed(true)} />
        </a>
        {action}
      </div>
    );
  const units =
    size < 1024
      ? `${size} B`
      : size < 1024 * 1024
        ? `${(size / 1024).toFixed(1)} KB`
        : `${(size / (1024 * 1024)).toFixed(1)} MB`;
  const Caption = onOpen ? "button" : "div";
  return (
    <div className={footer ? "attachment file-card" : "attachment"}>
      {thumbnail && (
        <button
          type="button"
          className="file-card-thumbnail"
          onClick={onOpen}
          aria-label={`查看 ${name} 的预览`}
        >
          <img src={thumbnail} alt="文件首页预览" />
        </button>
      )}
      <div className="file-attachment">
        {icon ? (
          <span className="file-type-icon" data-type={type} aria-hidden="true">
            {icon}
          </span>
        ) : (
          <svg className="file-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Z" />
            <path d="M14 3v5h5M8 13h8M8 17h5" />
          </svg>
        )}
        <Caption
          className="file-caption"
          type={onOpen ? "button" : undefined}
          onClick={onOpen}
          aria-label={onOpen ? `预览 ${name}` : undefined}
        >
          <strong title={name}>{name}</strong>
          <span>
            {type && `${type} · `}
            {units}
            {details && ` · ${details}`}
          </span>
        </Caption>
        {action}
      </div>
      {footer && <div className="file-card-actions">{footer}</div>}
    </div>
  );
}
