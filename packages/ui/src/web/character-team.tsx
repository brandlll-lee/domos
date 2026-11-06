import { type CSSProperties, useEffect, useRef } from "react";
import { brandCharacter, type CharacterShape } from "../characters.ts";
import { Character } from "./character.tsx";
import { animateCharacter } from "./character-motion.ts";
import { Button } from "./controls.tsx";

const characters: {
  shape: CharacterShape;
  color: string;
  name: string;
  weight: number;
  bounds: [number, number, number, number];
}[] = [
  {
    shape: "ghost",
    color: "#f69dd1",
    name: "幽灵",
    weight: 0.42,
    bounds: [20.9, 10.16, 78.22, 89.84],
  },
  {
    shape: "chat",
    color: "#4dd9cc",
    name: "气泡",
    weight: 0.58,
    bounds: [7.42, 11.82, 92.48, 87.99],
  },
  {
    shape: "controller",
    color: "#ffb675",
    name: "手柄",
    weight: 0.82,
    bounds: [6.74, 19.53, 93.07, 82.62],
  },
  {
    ...brandCharacter,
    name: "Domos",
    weight: 1.15,
    bounds: [7.49, 12.96, 92.9, 92.9],
  },
  {
    shape: "bunny",
    color: "#659fff",
    name: "兔子",
    weight: 0.82,
    bounds: [17.58, 9.77, 81.54, 87.79],
  },
  {
    shape: "rocket",
    color: "#f8bd3e",
    name: "火箭",
    weight: 0.58,
    bounds: [12.01, 7.23, 87.4, 93.46],
  },
  {
    shape: "sprout",
    color: "#c7a0f6",
    name: "幼苗",
    weight: 0.42,
    bounds: [16.41, 8.89, 84.96, 92.19],
  },
];

export function CharacterTeam() {
  const root = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    const host = root.current;
    if (!host) return;
    const cleanup = [...host.querySelectorAll<HTMLButtonElement>("button")].map(
      (button, index) => {
        const { shape, bounds } = characters[
          index
        ] as (typeof characters)[number];
        return animateCharacter(button, shape, bounds);
      },
    );
    return () => {
      for (const dispose of cleanup) dispose();
    };
  }, []);
  return (
    <fieldset ref={root} className="character-team" aria-label="Domos 角色">
      {characters.map(({ shape, color, name, weight, bounds }, index) => {
        const [left, top, right, bottom] = bounds;
        return (
          <Button
            key={shape}
            type="button"
            variant="ghost"
            aria-label={`向${name}打招呼`}
            style={
              {
                "--character-weight": weight,
                "--character-aspect": (right - left) / (bottom - top),
                "--character-delay": `${index * -1.31}s`,
              } as CSSProperties
            }
          >
            <span className="character-gesture">
              <Character
                shape={shape}
                color={color}
                state="idle"
                viewBox={`${left} ${top} ${right - left} ${bottom - top}`}
              />
            </span>
          </Button>
        );
      })}
    </fieldset>
  );
}
