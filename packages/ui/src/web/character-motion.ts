import { type CharacterShape, characterFaces } from "../characters.ts";

const spring = (stiffness: number, damping: number) => ({
  x: 0,
  v: 0,
  target: 0,
  stiffness,
  damping,
});
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

const items = new Map<
  HTMLElement,
  {
    control: HTMLElement;
    gesture: HTMLElement;
    shape: CharacterShape;
    bounds: readonly [number, number, number, number];
    intensity: number;
    visible: boolean;
    box?: DOMRect;
    springs: Record<
      "x" | "y" | "tilt" | "hop" | "squish" | "greeting",
      ReturnType<typeof spring>
    >;
    gaze: { x: number; y: number; attention: number };
    lastGreeting: number;
  }
>();
let stop: (() => void) | undefined;
let observer: IntersectionObserver;
let wake: () => void;

export function animateCharacter(
  element: HTMLElement,
  shape: CharacterShape,
  bounds: readonly [number, number, number, number] = [0, 0, 100, 100],
  intensity = 1,
) {
  items.set(element, {
    control: element.closest<HTMLElement>("button, a") ?? element,
    gesture: element.querySelector(".character-gesture") as HTMLElement,
    shape,
    bounds,
    intensity,
    visible: false,
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
  });
  if (!stop) stop = start();
  observer.observe(element);
  return () => {
    observer.unobserve(element);
    items.delete(element);
    if (!items.size) {
      stop?.();
      stop = undefined;
    }
  };
}

function start() {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let pointer: { x: number; y: number } | null = null;
  let hovered: HTMLElement | null = null;
  let frame = 0;
  let last = 0;
  let measure = true;
  const itemAt = (event: Event) =>
    [...items.entries()].find(
      ([, item]) =>
        item.visible &&
        event.target instanceof Node &&
        item.control.contains(event.target),
    );
  const release = () => {
    for (const item of items.values()) item.springs.squish.target = 0;
    wake();
  };
  const reset = () => {
    pointer = null;
    hovered = null;
    release();
  };
  const move = (event: PointerEvent) => {
    pointer = { x: event.clientX, y: event.clientY };
    const next =
      event.pointerType === "touch" ? null : (itemAt(event)?.[0] ?? null);
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
    const item = itemAt(event)?.[1];
    if (item) item.springs.squish.target = -0.035 * item.intensity;
    wake();
  };
  const down = (event: PointerEvent) => {
    move(event);
    press(event);
  };
  const greet = (event: Event) => {
    const item = itemAt(event)?.[1];
    if (!item || reduced.matches) return;
    release();
    const now = performance.now() / 1000;
    if (now - item.lastGreeting < 0.32) return;
    item.lastGreeting = now;
    item.springs.hop.v = clamp(
      item.springs.hop.v - 150 * item.intensity,
      -190 * item.intensity,
      60 * item.intensity,
    );
    item.springs.squish.v = 0.85 * item.intensity;
    item.springs.greeting.v = -15 * item.intensity;
    wake();
  };
  const keyDown = (event: KeyboardEvent) => {
    if (event.key === " " || event.key === "Enter") press(event);
  };
  wake = () => {
    measure = true;
    if (!frame && !document.hidden) frame = requestAnimationFrame(tick);
  };
  const tick = (now: number) => {
    frame = 0;
    const dt = last ? Math.min((now - last) / 1000, 0.04) : 1 / 60;
    last = now;
    let moving = false;
    const measured = [...items.entries()]
      .filter(([, item]) => item.visible)
      .map(([element, item]) => {
        const box =
          measure || !item.box ? element.getBoundingClientRect() : item.box;
        item.box = box;
        return { element, item, box };
      });
    measure = false;
    for (const { element, item, box } of measured) {
      const { springs, gaze, gesture, intensity } = item;
      const { x, y, tilt, hop, squish, greeting } = springs;
      const face = characterFaces[item.shape] ?? { x: 50, y: 46.4, scale: 1 };
      const [left, top, right, bottom] = item.bounds;
      const tracking = reduced.matches ? null : pointer;
      const dx = tracking
        ? (tracking.x -
            box.left -
            (box.width * (face.x - left)) / (right - left)) /
          Math.max(box.width, box.height, 160)
        : 0;
      const dy = tracking
        ? (tracking.y -
            box.top -
            (box.height * (face.y - top)) / (bottom - top)) /
          Math.max(box.width, box.height, 160)
        : 0;
      const distance = Math.hypot(dx, dy);
      const limit = distance ? Math.tanh(distance) / distance : 0;
      const ease = reduced.matches
        ? 1
        : 1 - Math.exp(-dt / (tracking ? 0.12 : 0.3));
      gaze.x += (dx * limit - gaze.x) * ease;
      gaze.y += (dy * limit - gaze.y) * ease;
      gaze.attention +=
        ((tracking ? 1 : 0) - gaze.attention) *
        (reduced.matches ? 1 : 1 - Math.exp(-dt / 0.3));
      const weight = gaze.attention * gaze.attention * (3 - 2 * gaze.attention);
      const active = !reduced.matches && hovered === element ? pointer : null;
      x.target = active
        ? clamp(((active.x - box.left) / box.width) * 2 - 1, -1, 1) *
          5 *
          intensity
        : 0;
      y.target = active
        ? clamp(((active.y - box.top) / box.height) * 2 - 1, -1, 1) *
          3 *
          intensity
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
      element.style.setProperty(
        "--character-gaze-x",
        `${gaze.x * weight * 2.2}px`,
      );
      element.style.setProperty(
        "--character-gaze-y",
        `${gaze.y * weight * 1.4}px`,
      );
      element.style.setProperty("--character-attention", String(weight));
      gesture.style.transform = `translate(${x.x * scale}px, ${(y.x + hop.x) * scale}px) rotate(${tilt.x + greeting.x * 1.1}deg) scale(${1 - squish.x * 0.55}, ${1 + squish.x})`;
      const elapsed = now / 1000 - item.lastGreeting - 0.38;
      element.toggleAttribute("data-blink", elapsed >= 0 && elapsed < 0.29);
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
        element.style.setProperty(
          "--character-blink",
          String(1 - blink * 0.975),
        );
      }
      moving ||=
        Math.abs(dx * limit - gaze.x) +
          Math.abs(dy * limit - gaze.y) +
          Math.abs((tracking ? 1 : 0) - gaze.attention) >
          0.001 ||
        Object.values(springs).some(
          (value) =>
            Math.abs(value.v) + Math.abs(value.target - value.x) > 0.001,
        ) ||
        elapsed < 0.29;
    }
    if (moving && !reduced.matches) frame = requestAnimationFrame(tick);
    else last = 0;
  };
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const item = items.get(entry.target as HTMLElement);
      if (item) item.visible = entry.isIntersecting;
      entry.target.toggleAttribute(
        "data-paused",
        !entry.isIntersecting || document.hidden,
      );
    }
    wake();
  });
  const visibility = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
    for (const [element, item] of items)
      element.toggleAttribute("data-paused", document.hidden || !item.visible);
    reset();
  };
  const motion = () => {
    reset();
    for (const item of items.values()) {
      item.lastGreeting = -Infinity;
      for (const value of Object.values(item.springs))
        value.x = value.v = value.target = 0;
    }
    wake();
  };
  window.addEventListener("pointermove", move, { passive: true });
  window.addEventListener("pointerdown", down, {
    passive: true,
    capture: true,
  });
  window.addEventListener("pointerout", leave);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", reset);
  window.addEventListener("blur", reset);
  window.addEventListener("click", greet, true);
  window.addEventListener("keydown", keyDown);
  window.addEventListener("keyup", release);
  window.addEventListener("resize", wake);
  document.addEventListener("scroll", wake, true);
  reduced.addEventListener("change", motion);
  document.addEventListener("visibilitychange", visibility);
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerdown", down, true);
    window.removeEventListener("pointerout", leave);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", reset);
    window.removeEventListener("blur", reset);
    window.removeEventListener("click", greet, true);
    window.removeEventListener("keydown", keyDown);
    window.removeEventListener("keyup", release);
    window.removeEventListener("resize", wake);
    document.removeEventListener("scroll", wake, true);
    reduced.removeEventListener("change", motion);
    document.removeEventListener("visibilitychange", visibility);
  };
}
