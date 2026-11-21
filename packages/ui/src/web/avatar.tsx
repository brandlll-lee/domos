import { createContext, memo, useContext, useEffect, useRef } from "react";
import {
  brandCharacter,
  type CharacterMedia,
  characterIdentity,
  characterNames,
} from "../characters.ts";
import { avatarImageStatus, prepareAvatarImages } from "./avatar-images.ts";
import { Character, characterImages } from "./character.tsx";
import { animateCharacter } from "./character-motion.ts";
import type { CharacterWork } from "./character-work.tsx";
import { StatusDot } from "./status-dot.tsx";
import { UnreadBadge } from "./unread-badge.tsx";

export {
  avatarImageStatus,
  prepareAvatarImages,
  retryAvatarImages,
  useAvatarImages,
} from "./avatar-images.ts";
export { characterImages, thumbnailEyes } from "./character.tsx";

export const characterPickerImages = [
  ...new Set(
    Object.keys(characterNames).flatMap((shape) =>
      characterImages(shape as keyof typeof characterNames, true),
    ),
  ),
];

export const AvatarMediaContext = createContext<Record<string, CharacterMedia>>(
  {},
);

export async function prepareBotAvatar(
  seed: string,
  media: CharacterMedia | undefined,
  thumbnail: boolean,
) {
  if (media) {
    const cover = thumbnail ? (media.thumbnail ?? media.cover) : media.cover;
    await prepareAvatarImages([cover]);
    if (avatarImageStatus(cover) === "ready") return true;
  }
  const urls = characterImages(characterIdentity(seed).shape, thumbnail);
  await prepareAvatarImages(urls);
  return urls.every((url) => avatarImageStatus(url) === "ready");
}

type Motion = "idle" | "running";

export const BotAvatar = memo(function BotAvatar({
  seed,
  botId,
  color,
  state = "idle",
  size = "medium",
  statusLabel,
  interactive = false,
  unread = 0,
  work,
  media,
}: {
  seed: string;
  botId?: number;
  color?: string;
  state?: Motion;
  size?: "small" | "medium" | "panel" | "large";
  statusLabel?: string;
  interactive?: boolean;
  unread?: number;
  work?: CharacterWork;
  media?: CharacterMedia;
}) {
  const catalog = useContext(AvatarMediaContext);
  const source = media ?? (botId ? catalog[botId] : undefined);
  const identity = characterIdentity(seed);
  const workingAvatar = work !== undefined;
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if ((interactive || workingAvatar) && root.current)
      return animateCharacter(
        root.current,
        identity.shape,
        undefined,
        interactive ? (size === "panel" ? 0.6 : 0.35) : 0,
      );
  }, [interactive, identity.shape, size, workingAvatar]);
  return (
    <span ref={root} className="bot-avatar" data-size={size} data-seed={seed}>
      <span className="character-gesture">
        <Character
          media={source}
          thumbnail={size !== "large"}
          animateMedia={workingAvatar || size === "panel" || size === "large"}
          shape={identity.shape}
          color={color ?? identity.color}
          state={state}
          work={work}
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
      <Character {...brandCharacter} state="idle" thumbnail />
    </span>
  );
}
