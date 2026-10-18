import { memo } from "react";
import { brandCharacter, characterIdentity } from "../characters.ts";
import { Character } from "./character.tsx";

type Motion = "idle" | "running";

export const BotAvatar = memo(function BotAvatar({
  seed,
  color,
  state = "idle",
  size = "medium",
  statusLabel,
}: {
  seed: string;
  color?: string;
  state?: Motion;
  size?: "small" | "medium" | "large";
  statusLabel?: string;
}) {
  const identity = characterIdentity(seed);
  return (
    <span className="bot-avatar" data-size={size} data-seed={seed}>
      <Character
        shape={identity.shape}
        color={color ?? identity.color}
        state={state}
      />
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

export function Brand() {
  return (
    <span className="wordmark">
      <BrandMark />
      <span>Domos</span>
    </span>
  );
}
