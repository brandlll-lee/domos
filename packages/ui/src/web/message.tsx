import type { ReactNode } from "react";

export function InlineNotice({
  children,
  icon,
  onClick,
  align = "start",
  className = "",
}: {
  children: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
  align?: "start" | "center";
  className?: string;
}) {
  const content = (
    <>
      {icon && (
        <span className="inline-notice-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span>{children}</span>
    </>
  );
  return (
    <div className={`inline-notice ${className}`} data-align={align}>
      {onClick ? (
        <button
          type="button"
          className="inline-notice-content"
          onClick={onClick}
        >
          {content}
        </button>
      ) : (
        <span className="inline-notice-content">{content}</span>
      )}
    </div>
  );
}

export function MessageBubble({
  side,
  children,
}: {
  side: "incoming" | "outgoing";
  children: ReactNode;
}) {
  return (
    <div className="message-bubble" data-side={side}>
      {children}
    </div>
  );
}
