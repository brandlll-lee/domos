import { useEffect, useId, useMemo, useRef, useState } from "react";
import bunny from "../../assets/characters/bunny.webp";
import capsule from "../../assets/characters/capsule.webp";
import cat from "../../assets/characters/cat.webp";
import chat from "../../assets/characters/chat.webp";
import cloud from "../../assets/characters/cloud.webp";
import controller from "../../assets/characters/controller.webp";
import drop from "../../assets/characters/drop.webp";
import ivory from "../../assets/characters/eye-ivory.webp";
import pupil from "../../assets/characters/eye-velvet.webp";
import ghost from "../../assets/characters/ghost.webp";
import heart from "../../assets/characters/heart.webp";
import hex from "../../assets/characters/hex.webp";
import rocket from "../../assets/characters/rocket.webp";
import round from "../../assets/characters/round.webp";
import soft from "../../assets/characters/soft.webp";
import sprout from "../../assets/characters/sprout.webp";
import star from "../../assets/characters/star.webp";
import bunnyThumbnail from "../../assets/characters/thumbnails/bunny.webp";
import capsuleThumbnail from "../../assets/characters/thumbnails/capsule.webp";
import catThumbnail from "../../assets/characters/thumbnails/cat.webp";
import chatThumbnail from "../../assets/characters/thumbnails/chat.webp";
import cloudThumbnail from "../../assets/characters/thumbnails/cloud.webp";
import controllerThumbnail from "../../assets/characters/thumbnails/controller.webp";
import dropThumbnail from "../../assets/characters/thumbnails/drop.webp";
import ivoryThumbnail from "../../assets/characters/thumbnails/eye-ivory.webp";
import pupilThumbnail from "../../assets/characters/thumbnails/eye-velvet.webp";
import ghostThumbnail from "../../assets/characters/thumbnails/ghost.webp";
import heartThumbnail from "../../assets/characters/thumbnails/heart.webp";
import hexThumbnail from "../../assets/characters/thumbnails/hex.webp";
import rocketThumbnail from "../../assets/characters/thumbnails/rocket.webp";
import roundThumbnail from "../../assets/characters/thumbnails/round.webp";
import softThumbnail from "../../assets/characters/thumbnails/soft.webp";
import sproutThumbnail from "../../assets/characters/thumbnails/sprout.webp";
import starThumbnail from "../../assets/characters/thumbnails/star.webp";
import triangleThumbnail from "../../assets/characters/thumbnails/triangle.webp";
import triangle from "../../assets/characters/triangle.webp";
import {
  type CharacterMedia,
  type CharacterShape,
  characterFaces,
} from "../characters.ts";
import { useAvatarImages } from "./avatar-images.ts";
import {
  type CharacterWork,
  WorkBurst,
  WorkComputer,
  WorkHeadset,
} from "./character-work.tsx";

const textures = {
  bunny: [bunny, bunnyThumbnail],
  capsule: [capsule, capsuleThumbnail],
  cat: [cat, catThumbnail],
  chat: [chat, chatThumbnail],
  cloud: [cloud, cloudThumbnail],
  controller: [controller, controllerThumbnail],
  drop: [drop, dropThumbnail],
  ghost: [ghost, ghostThumbnail],
  heart: [heart, heartThumbnail],
  hex: [hex, hexThumbnail],
  rocket: [rocket, rocketThumbnail],
  round: [round, roundThumbnail],
  soft: [soft, softThumbnail],
  sprout: [sprout, sproutThumbnail],
  star: [star, starThumbnail],
  triangle: [triangle, triangleThumbnail],
} as const;
export const thumbnailEyes = [ivoryThumbnail, pupilThumbnail] as const;

export function characterImages(
  shape: CharacterShape,
  thumbnail: boolean,
): readonly [string, string, string] {
  return thumbnail
    ? [textures[shape][1], ...thumbnailEyes]
    : [textures[shape][0], ivory, pupil];
}

const bodyPadding = (48 / 1024) * 100;
const channels = (color: string) =>
  [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16));

const linear = (value: number) =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const srgb = (value: number) =>
  value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;

function tint(color: string) {
  return channels(color).map((channel) => {
    const ink = linear(channel / 255);
    return Array.from({ length: 256 }, (_, index) => {
      const gray = index / 255;
      // Neutral bodies have a 0.55 median; linear light retains fiber shading.
      const shade = (linear(gray) / linear(0.55)) ** 0.6;
      const sheen = 0.08 * Math.max(0, (gray - 0.55) / 0.45) ** 2;
      const value = Math.min(1, ink * shade);
      return (
        Math.round(255 * srgb(value + (1 - value) * sheen)) / 255
      ).toFixed(6);
    }).join(" ");
  });
}

function Eye({
  cx,
  clip,
  shadow,
  white,
  iris,
}: {
  cx: number;
  clip: string;
  shadow: string;
  white: string;
  iris: string;
}) {
  return (
    <g clipPath={`url(#${clip})`}>
      <ellipse
        cx={cx}
        cy="46.4"
        rx="11.1"
        ry="14.1"
        fill="#f6f5ea"
        filter={`url(#${shadow})`}
      />
      <image href={white} x={cx - 11.8} y="31.6" width="23.6" height="29.6" />
      <g className="character-look">
        <g className="character-pupils">
          <image
            href={iris}
            x={cx - 5.35}
            y="38.65"
            width="10.7"
            height="15.5"
          />
        </g>
      </g>
    </g>
  );
}

export function Character({
  shape,
  color,
  state,
  work,
  media,
  animateMedia = false,
  thumbnail = false,
  viewBox = "0 0 100 100",
}: {
  shape: CharacterShape;
  color: string;
  state: "idle" | "running";
  work?: CharacterWork;
  media?: CharacterMedia;
  animateMedia?: boolean;
  thumbnail?: boolean;
  viewBox?: string;
}) {
  const id = useId();
  const root = useRef<SVGSVGElement>(null);
  const [playing, setPlaying] = useState(false);
  const cover = thumbnail ? (media?.thumbnail ?? media?.cover) : media?.cover;
  const coverImages = useMemo(() => (cover ? [cover] : []), [cover]);
  const coverReady = useAvatarImages(coverImages) === "ready" && !!media;
  const previewImages = useMemo(
    () => (media?.thumbnail && !thumbnail ? [media.thumbnail] : []),
    [media?.thumbnail, thumbnail],
  );
  const previewReady =
    useAvatarImages(previewImages) === "ready" && !!media?.thumbnail;
  const animatedSource =
    coverReady && playing && (!work?.id || work.working)
      ? media.src
      : undefined;
  const animationImages = useMemo(
    () => (animatedSource ? [animatedSource] : []),
    [animatedSource],
  );
  const animationReady = useAvatarImages(animationImages) === "ready";
  const builtInImages = useMemo(
    () => characterImages(shape, thumbnail),
    [shape, thumbnail],
  );
  const emptyImages = useMemo(() => [], []);
  const fullReady =
    useAvatarImages(coverReady ? emptyImages : builtInImages) === "ready";
  const smallImages = useMemo(() => characterImages(shape, true), [shape]);
  const smallReady =
    useAvatarImages(coverReady ? emptyImages : smallImages) === "ready";
  const builtInReady = fullReady || smallReady;
  const [texture, white, iris] = fullReady ? builtInImages : smallImages;
  const visibleMedia = coverReady
    ? { ...media, cover }
    : previewReady
      ? { ...media, cover: media.thumbnail }
      : undefined;
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let visible = false;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      element.toggleAttribute("data-paused", !visible || document.hidden);
      setPlaying(
        Boolean(
          media &&
            animateMedia &&
            visible &&
            !document.hidden &&
            !reduced.matches,
        ),
      );
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      update();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", update);
    reduced.addEventListener("change", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
      reduced.removeEventListener("change", update);
    };
  }, [media, animateMedia]);
  const previous = useRef(work?.id);
  const [entering, setEntering] = useState(false);
  useEffect(() => {
    if (!work?.id) {
      setEntering(false);
      return;
    }
    if (previous.current === work.id) return;
    previous.current = work.id;
    setEntering(!matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, [work?.id]);
  const face = visibleMedia?.headset ??
    characterFaces[shape] ?? { x: 50, y: 46.4, scale: 1 };
  const computer = visibleMedia?.computer ?? face;
  const [red, green, blue] = useMemo(() => tint(color), [color]);
  return (
    <svg
      ref={root}
      className="character"
      viewBox={viewBox}
      aria-hidden="true"
      data-state={state}
      data-shape={shape}
      data-work={work?.id ? (work.working ? "working" : "waiting") : undefined}
      data-entering={entering || undefined}
      onAnimationEnd={(event) => {
        if (event.animationName === "character-work-arrival")
          setEntering(false);
      }}
    >
      <defs>
        <filter id={`${id}-tint`} colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncR type="table" tableValues={red} />
            <feFuncG type="table" tableValues={green} />
            <feFuncB type="table" tableValues={blue} />
          </feComponentTransfer>
        </filter>
        <filter
          id={`${id}-shadow`}
          x="-35%"
          y="-25%"
          width="170%"
          height="170%"
        >
          <feDropShadow
            dx=".15"
            dy=".55"
            stdDeviation=".65"
            floodColor="#344018"
            floodOpacity=".42"
          />
        </filter>
        {[37.4, 62.6].map((cx, index) => (
          <clipPath
            id={`${id}-${index}`}
            key={cx}
            clipPathUnits="userSpaceOnUse"
          >
            <rect
              className="character-eyelid"
              data-side={index}
              x={cx - 12.4}
              y="31"
              width="24.8"
              height="30.8"
              rx="12.4"
            />
          </clipPath>
        ))}
      </defs>
      <g
        className="character-work-arrival"
        visibility={visibleMedia || builtInReady ? undefined : "hidden"}
      >
        <g className="character-pose">
          <g className="character-body">
            {visibleMedia ? (
              <image
                href={
                  animationReady && animatedSource
                    ? animatedSource
                    : visibleMedia.cover
                }
                x="0"
                y="0"
                width="100"
                height="100"
                preserveAspectRatio="xMidYMid meet"
              />
            ) : (
              builtInReady && (
                <image
                  href={texture}
                  x={-bodyPadding}
                  y={-bodyPadding}
                  width={100 + bodyPadding * 2}
                  height={100 + bodyPadding * 2}
                  filter={`url(#${id}-tint)`}
                />
              )
            )}
            <g
              transform={`translate(${face.x} ${face.y}) scale(${face.scale}) translate(-50 -46.4)`}
            >
              {!visibleMedia && builtInReady && (
                <g className="character-face">
                  {[37.4, 62.6].map((cx, index) => (
                    <Eye
                      key={cx}
                      cx={cx}
                      clip={`${id}-${index}`}
                      shadow={`${id}-shadow`}
                      white={white}
                      iris={iris}
                    />
                  ))}
                </g>
              )}
              {work && <WorkHeadset />}
            </g>
          </g>
        </g>
        {work && (
          <g
            transform={`translate(${computer.x} ${computer.y}) scale(${computer.scale}) translate(-50 -46.4)`}
          >
            <WorkComputer id={id} />
          </g>
        )}
      </g>
      {work && <WorkBurst color={color} />}
    </svg>
  );
}
