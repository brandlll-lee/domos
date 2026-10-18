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
      {["left", "middle", "right"].map((position) => (
        <span key={position}>
          <svg viewBox="0 0 10 16" aria-hidden="true">
            <circle cx="5" cy="8" r="2.5" />
          </svg>
        </span>
      ))}
    </div>
  );
}
