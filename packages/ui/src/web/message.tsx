import type { ReactNode } from "react";

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
