import { MessageBubble } from "@domos/ui/message";
import { useLayoutEffect, useState } from "react";

export function TypingDots({
  active,
  label,
  status,
  onLayout,
}: {
  active: boolean;
  label: string;
  status?: string | null;
  onLayout: () => void;
}) {
  const [visible, setVisible] = useState(active);
  useLayoutEffect(() => {
    if (active) setVisible(true);
  }, [active]);
  useLayoutEffect(() => {
    if (status || !active || !visible) onLayout();
  }, [active, visible, onLayout, status]);
  if (!visible) return null;
  return (
    <div
      className="typing-row"
      data-active={active}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && !active) setVisible(false);
      }}
    >
      <MessageBubble side="incoming">
        {status ? (
          <p className="working" role="status">
            {status}
          </p>
        ) : (
          <div className="typing-dots" role="status" aria-label={label}>
            <svg viewBox="0 0 68 40" aria-hidden="true">
              {[22, 34, 46].map((x) => (
                <g key={x}>
                  <circle cx={x} cy="20" r="3.5" />
                </g>
              ))}
            </svg>
          </div>
        )}
      </MessageBubble>
    </div>
  );
}
