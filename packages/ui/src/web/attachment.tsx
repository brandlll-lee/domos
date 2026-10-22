import { type ReactNode, useState } from "react";

export function FileAttachment({
  name,
  size,
  action,
  preview,
  icon,
  type,
}: {
  name: string;
  size: number;
  action: ReactNode;
  preview?: string;
  icon?: ReactNode;
  type?: string;
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
  return (
    <div className="attachment">
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
        <div className="file-caption">
          <strong title={name}>{name}</strong>
          <span>
            {type && `${type} · `}
            {units}
          </span>
        </div>
        {action}
      </div>
    </div>
  );
}
