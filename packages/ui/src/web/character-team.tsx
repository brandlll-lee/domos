import { type CSSProperties, useEffect, useRef } from "react";
import {
  brandCharacter,
  type CharacterShape,
  characterFaces,
} from "../characters.ts";
import { Character } from "./character.tsx";
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

const spring = (stiffness: number, damping: number) => ({
  x: 0,
  v: 0,
  target: 0,
  stiffness,
  damping,
});
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export function CharacterTeam() {
  const root = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    const host = root.current;
    if (!host) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const items = [...host.querySelectorAll<HTMLButtonElement>("button")].map(
      (button, index) => ({
        button,
        definition: characters[index] as (typeof characters)[number],
        gesture: button.querySelector(".character-gesture") as HTMLElement,
        springs: {
          x: spring(115, 20),
          y: spring(115, 20),
          tilt: spring(110, 18),
          hop: spring(155, 17),
          squish: spring(240, 23),
          greeting: spring(100, 13),
        },
        gaze: { x: 0, y: 0, attention: 0 },
        lastGreeting: -Infinity,
      }),
    );
    let pointer: { x: number; y: number } | null = null;
    let hovered: HTMLButtonElement | null = null;
    let frame = 0;
    let last = 0;
    const buttonAt = (event: Event) =>
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>(".character-team > button")
        : null;
    const release = () => {
      for (const item of items) item.springs.squish.target = 0;
    };
    const reset = () => {
      pointer = null;
      hovered = null;
      release();
      wake();
    };
    const move = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      const next = event.pointerType === "touch" ? null : buttonAt(event);
      if (next !== hovered) release();
      hovered = next;
      wake();
    };
    const leave = (event: PointerEvent) => {
      if (!event.relatedTarget) reset();
    };
    const up = (event: PointerEvent) => {
      release();
      if (event.pointerType !== "mouse") reset();
    };
    const press = (event: Event) => {
      if (
        reduced.matches ||
        (event instanceof PointerEvent && event.button !== 0)
      )
        return;
      const item = items.find((item) => item.button === buttonAt(event));
      if (item) item.springs.squish.target = -0.035;
    };
    const greet = (event: Event) => {
      const item = items.find((item) => item.button === buttonAt(event));
      if (!item || reduced.matches) return;
      release();
      const now = performance.now() / 1000;
      if (now - item.lastGreeting < 0.32) return;
      item.lastGreeting = now;
      item.springs.hop.v = clamp(item.springs.hop.v - 150, -190, 60);
      item.springs.squish.v = 0.85;
      item.springs.greeting.v = -15;
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === " " || event.key === "Enter") press(event);
    };
    const wake = () => {
      if (!frame && !document.hidden) frame = requestAnimationFrame(tick);
    };
    const tick = (now: number) => {
      frame = 0;
      const dt = last ? Math.min((now - last) / 1000, 0.04) : 0;
      last = now;
      const measured = items.map((item) => ({
        item,
        box: item.button.getBoundingClientRect(),
      }));
      for (const { item, box } of measured) {
        const { button, springs, gaze, definition, gesture } = item;
        const { x, y, tilt, hop, squish, greeting } = springs;
        const face = characterFaces[definition.shape] ?? {
          x: 50,
          y: 46.4,
          scale: 1,
        };
        const [left, top, right, bottom] = definition.bounds;
        const dx = pointer
          ? (pointer.x -
              box.left -
              (box.width * (face.x - left)) / (right - left)) /
            Math.max(box.width, box.height, 160)
          : 0;
        const dy = pointer
          ? (pointer.y -
              box.top -
              (box.height * (face.y - top)) / (bottom - top)) /
            Math.max(box.width, box.height, 160)
          : 0;
        const distance = Math.hypot(dx, dy);
        const limit = distance ? Math.tanh(distance) / distance : 0;
        const ease = reduced.matches
          ? 1
          : 1 - Math.exp(-dt / (pointer ? 0.12 : 0.3));
        gaze.x += (dx * limit - gaze.x) * ease;
        gaze.y += (dy * limit - gaze.y) * ease;
        gaze.attention +=
          ((pointer ? 1 : 0) - gaze.attention) *
          (reduced.matches ? 1 : 1 - Math.exp(-dt / 0.3));
        const weight =
          gaze.attention * gaze.attention * (3 - 2 * gaze.attention);
        const active = !reduced.matches && hovered === button ? pointer : null;
        x.target = active
          ? clamp(((active.x - box.left) / box.width) * 2 - 1, -1, 1) * 5
          : 0;
        y.target = active
          ? clamp(((active.y - box.top) / box.height) * 2 - 1, -1, 1) * 3
          : 0;
        tilt.target = x.target * 0.17;
        const count = Math.ceil(dt * 120);
        for (let i = 0; i < count; i++)
          for (const value of Object.values(springs)) {
            value.v +=
              ((value.stiffness * (value.target - value.x) -
                value.damping * value.v) *
                dt) /
              count;
            value.x += (value.v * dt) / count;
          }
        const scale = box.height / 100;
        button.style.setProperty(
          "--character-gaze-x",
          `${gaze.x * weight * 2.2}px`,
        );
        button.style.setProperty(
          "--character-gaze-y",
          `${gaze.y * weight * 1.4}px`,
        );
        button.style.setProperty("--character-attention", String(weight));
        gesture.style.transform = `translate(${x.x * scale}px, ${(y.x + hop.x) * scale}px) rotate(${tilt.x + greeting.x * 1.1}deg) scale(${1 - squish.x * 0.55}, ${1 + squish.x})`;
        const elapsed = now / 1000 - item.lastGreeting - 0.38;
        button.toggleAttribute("data-blink", elapsed >= 0 && elapsed < 0.29);
        if (elapsed >= 0 && elapsed < 0.29) {
          const smooth = (value: number) => {
            const t = clamp(value, 0, 1);
            return t * t * (3 - 2 * t);
          };
          const blink =
            elapsed < 0.085
              ? smooth(elapsed / 0.085)
              : elapsed < 0.13
                ? 1
                : 1 - smooth((elapsed - 0.13) / 0.16);
          button.style.setProperty(
            "--character-blink",
            String(1 - blink * 0.975),
          );
        }
      }
      if (!reduced.matches) wake();
    };
    const visibility = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
      host.toggleAttribute("data-paused", document.hidden);
      if (document.hidden) reset();
      else wake();
    };
    const motion = () => {
      release();
      hovered = null;
      for (const item of items)
        for (const value of Object.values(item.springs))
          value.x = value.v = value.target = 0;
      wake();
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", move, {
      passive: true,
      capture: true,
    });
    window.addEventListener("pointerout", leave);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", reset);
    window.addEventListener("blur", reset);
    host.addEventListener("pointerdown", press);
    host.addEventListener("click", greet);
    host.addEventListener("keydown", keyDown);
    host.addEventListener("keyup", release);
    reduced.addEventListener("change", motion);
    document.addEventListener("visibilitychange", visibility);
    visibility();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", move, true);
      window.removeEventListener("pointerout", leave);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", reset);
      window.removeEventListener("blur", reset);
      host.removeEventListener("pointerdown", press);
      host.removeEventListener("click", greet);
      host.removeEventListener("keydown", keyDown);
      host.removeEventListener("keyup", release);
      reduced.removeEventListener("change", motion);
      document.removeEventListener("visibilitychange", visibility);
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
