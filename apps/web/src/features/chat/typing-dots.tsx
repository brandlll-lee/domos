import { MessageBubble } from "@domos/ui/message";

export function TypingDots({
  label,
  status,
}: {
  label: string;
  status?: string | null;
}) {
  return (
    <div className="typing-row">
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
