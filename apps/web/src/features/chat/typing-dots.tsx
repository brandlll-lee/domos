import { characterIdentity } from "@domos/ui/characters";
import type { CSSProperties } from "react";

export function TypingDots({
  avatar,
  label,
}: {
  avatar: string;
  label: string;
}) {
  return (
    <div
      className="typing-dots"
      style={
        { "--typing-color": characterIdentity(avatar).color } as CSSProperties
      }
      role="status"
      aria-label={label}
    >
      <svg viewBox="0 0 68 40" aria-hidden="true">
        {[22, 34, 46].map((x) => (
          <g key={x}>
            <circle cx={x} cy="20" r="3.5" />
          </g>
        ))}
      </svg>
    </div>
  );
}
