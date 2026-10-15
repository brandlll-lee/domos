import { type ReactNode, useState } from "react";

export function FileAttachment({
  name,
  size,
  action,
  preview,
}: {
  name: string;
  size: number;
  action: ReactNode;
  preview?: string;
}) {
  const [failed, setFailed] = useState(false);
  const units =
    size < 1024
      ? `${size} B`
      : size < 1024 * 1024
        ? `${(size / 1024).toFixed(1)} KB`
        : `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return (
    <div className="attachment">
      {preview && !failed && (
        <a
          className="attachment-preview"
          href={preview}
          target="_blank"
          rel="noreferrer"
        >
          <img
            src={preview}
            alt={name}
            loading="lazy"
            onError={() => setFailed(true)}
          />
        </a>
      )}
      <div className="file-attachment">
        <div className="file-caption">
          <strong title={name}>{name}</strong>
          <span>{units}</span>
        </div>
        {action}
      </div>
    </div>
  );
}
