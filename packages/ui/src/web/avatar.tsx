import { memo, useEffect, useRef } from "react";
import { brandCharacter, characterIdentity } from "../characters.ts";
import { Character } from "./character.tsx";
import { animateCharacter } from "./character-motion.ts";

type Motion = "idle" | "running";

export const BotAvatar = memo(function BotAvatar({
  seed,
  color,
  state = "idle",
  size = "medium",
  statusLabel,
  interactive = false,
}: {
  seed: string;
  color?: string;
  state?: Motion;
  size?: "small" | "medium" | "panel" | "large";
  statusLabel?: string;
  interactive?: boolean;
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
        <span className="avatar-status" role="img" aria-label={statusLabel} />
      )}
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
