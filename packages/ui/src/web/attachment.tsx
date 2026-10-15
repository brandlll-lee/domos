import type { ReactNode } from "react";

export function FileAttachment({
  name,
  size,
  action,
}: {
  name: string;
  size: number;
  action: ReactNode;
}) {
  const units =
    size < 1024
      ? `${size} B`
      : size < 1024 * 1024
        ? `${(size / 1024).toFixed(1)} KB`
        : `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return (
    <div className="file-attachment">
      <div className="file-caption">
        <strong title={name}>{name}</strong>
        <span>{units}</span>
      </div>
      {action}
    </div>
  );
}
