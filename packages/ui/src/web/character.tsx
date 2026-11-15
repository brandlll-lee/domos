import { useId, useMemo } from "react";
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
import triangle from "../../assets/characters/triangle.webp";
import { type CharacterShape, characterFaces } from "../characters.ts";

const textures = {
  cat,
  bunny,
  ghost,
  rocket,
  controller,
  sprout,
  chat,
  cloud,
  drop,
  heart,
  hex,
  round,
  soft,
  star,
  triangle,
  capsule,
};
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
}: {
  cx: number;
  clip: string;
  shadow: string;
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
      <image href={ivory} x={cx - 11.8} y="31.6" width="23.6" height="29.6" />
      <g className="character-look">
        <g className="character-pupils">
          <image
            href={pupil}
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
  viewBox = "0 0 100 100",
}: {
  shape: CharacterShape;
  color: string;
  state: "idle" | "running";
  viewBox?: string;
}) {
  const id = useId();
  const face = characterFaces[shape] ?? { x: 50, y: 46.4, scale: 1 };
  const texture = textures[shape];
  const [red, green, blue] = useMemo(() => tint(color), [color]);
  return (
    <svg
      className="character"
      viewBox={viewBox}
      aria-hidden="true"
      data-state={state}
      data-shape={shape}
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
      <g className="character-pose">
        <g className="character-body">
          <image
            href={texture}
            width="100"
            height="100"
            filter={`url(#${id}-tint)`}
          />
          <g
            transform={`translate(${face.x} ${face.y}) scale(${face.scale}) translate(-50 -46.4)`}
          >
            <g className="character-face">
              {[37.4, 62.6].map((cx, index) => (
                <Eye
                  key={cx}
                  cx={cx}
                  clip={`${id}-${index}`}
                  shadow={`${id}-shadow`}
                />
              ))}
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}
