import { useId } from "react";
import { type CharacterShape, characterBaseColor } from "../characters.ts";

const ivory = new URL("../../assets/characters/eye-ivory.webp", import.meta.url)
  .href;
const pupil = new URL(
  "../../assets/characters/eye-velvet.webp",
  import.meta.url,
).href;
const channels = (color: string) =>
  [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16));

function tint(color: string) {
  const base = channels(characterBaseColor);
  const [r, g, b] = channels(color).map(
    (value, index) => value / (base[index] ?? 1),
  );
  return `${r} 0 0 0 0 0 ${g} 0 0 0 0 0 ${b} 0 0 0 0 0 1 0`;
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
  );
}

export function Character({
  shape,
  color,
  state,
}: {
  shape: CharacterShape;
  color: string;
  state: "idle" | "running";
}) {
  const id = useId();
  const texture = new URL(
    `../../assets/characters/${shape}.webp`,
    import.meta.url,
  ).href;
  return (
    <svg
      className="character"
      viewBox="0 0 100 100"
      aria-hidden="true"
      data-state={state}
      data-shape={shape}
    >
      <defs>
        <filter id={`${id}-tint`} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={tint(color)} />
          <feComponentTransfer>
            <feFuncR type="gamma" exponent=".86" />
            <feFuncG type="gamma" exponent=".86" />
            <feFuncB type="gamma" exponent=".86" />
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
    </svg>
  );
}
