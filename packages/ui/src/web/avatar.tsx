import { memo, useEffect, useRef } from "react";
import { brandCharacter, characterIdentity } from "../characters.ts";
import { Character } from "./character.tsx";
import { animateCharacter } from "./character-motion.ts";
import { StatusDot } from "./status-dot.tsx";
import { UnreadBadge } from "./unread-badge.tsx";

type Motion = "idle" | "running";

export const BotAvatar = memo(function BotAvatar({
  seed,
  color,
  state = "idle",
  size = "medium",
  statusLabel,
  interactive = false,
  unread = 0,
}: {
  seed: string;
  color?: string;
  state?: Motion;
  size?: "small" | "medium" | "panel" | "large";
  statusLabel?: string;
  interactive?: boolean;
  unread?: number;
}) {
  const identity = characterIdentity(seed);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (interactive && root.current)
      return animateCharacter(
        root.current,
        identity.shape,
        undefined,
        size === "panel" ? 0.6 : 0.35,
      );
  }, [interactive, identity.shape, size]);
  return (
    <span ref={root} className="bot-avatar" data-size={size} data-seed={seed}>
      <span className="character-gesture">
        <Character
          shape={identity.shape}
          color={color ?? identity.color}
          state={state}
        />
      </span>
      {state === "running" && statusLabel && (
        <StatusDot tone="positive" label={statusLabel} />
      )}
      <UnreadBadge count={unread} />
    </span>
  );
});

export function BrandMark() {
  return (
    <span className="brand-mark">
      <Character {...brandCharacter} state="idle" />
    </span>
  );
}
