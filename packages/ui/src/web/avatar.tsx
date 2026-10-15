import type { CSSProperties } from "react";
import { characterIdentity, characterShapes } from "../characters.ts";

type Motion = "idle" | "running";

function Character({
  path,
  state,
  smile = false,
}: {
  path: string;
  state: Motion;
  smile?: boolean;
}) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" data-state={state}>
      <g className="character-body">
        <path d={path} fill="var(--character-fill)" />
        <g className="character-face">
          {[37.4, 62.6].map((cx) => (
            <g className="character-eye" key={cx}>
              <ellipse
                cx={cx}
                cy="46.4"
                rx="11.1"
                ry="14.1"
                fill="var(--character-eye)"
              />
              <rect
                className="character-pupil"
                x={cx - 4.8}
                y="39.2"
                width="9.6"
                height="14.4"
                rx="4.8"
                fill="var(--character-pupil)"
              />
            </g>
          ))}
          {smile && (
            <path
              className="character-mouth"
              d="M43.4 67.1Q50 73.7 56.6 67.1"
              fill="none"
              stroke="var(--character-eye)"
              strokeWidth="2.1"
              strokeLinecap="round"
            />
          )}
        </g>
      </g>
    </svg>
  );
}

export function BotAvatar({
  seed,
  state = "idle",
  size = "medium",
  statusLabel,
}: {
  seed: string;
  state?: Motion;
  size?: "small" | "medium" | "large";
  statusLabel?: string;
}) {
  const identity = characterIdentity(seed);
  return (
    <span
      className="bot-avatar"
      data-size={size}
      data-seed={seed}
      style={{ "--character-fill": identity.color } as CSSProperties}
    >
      <Character path={identity.path} state={state} />
      {state === "running" && statusLabel && (
        <span className="avatar-status" role="img" aria-label={statusLabel} />
      )}
    </span>
  );
}

export function BrandMark() {
  return (
    <span className="brand-mark">
      <Character path={characterShapes.soft} state="idle" smile />
    </span>
  );
}
