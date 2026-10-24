import { effectArt } from "./computer-effect-art.mjs";

export function mountComputerEffect(container) {
  return mountComputerEffectWithArt(container, effectArt);
}

export function mountComputerEffectWithArt(container, art) {
  const root = container.shadowRoot ?? container.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${art.styles}</style>${art.markup}`;
  container.setAttribute("aria-hidden", "true");
  const rim = root.querySelector(".rim");
  const cut = root.querySelector(".cut");
  const cursor = root.querySelector(".cursor");
  const hotspot = 5;
  let timer;
  let action;
  let latest;
  let playing;
  let destination;
  const reducedMotion = matchMedia("(prefers-reduced-motion:reduce)");
  function hide() {
    rim.hidden = cursor.hidden = true;
    cut.style.maskImage = "";
    playing?.cancel();
    playing = destination = undefined;
  }
  function draw() {
    const value = latest;
    if (!value || value.expiresAt <= Date.now()) return hide();
    const screen = value.screen;
    if (!screen || screen.width <= 0 || screen.height <= 0) return hide();
    const sx = container.clientWidth / screen.width;
    const sy = container.clientHeight / screen.height;
    container.style.setProperty("--bot-color", value.color);
    const bounds = value.window;
    rim.hidden = !bounds;
    if (bounds) {
      Object.assign(rim.style, {
        left: `${(bounds.x - screen.x) * sx}px`,
        top: `${(bounds.y - screen.y) * sy}px`,
        width: `${bounds.width * sx}px`,
        height: `${bounds.height * sy}px`,
      });
      const pad = 40;
      const holes = (value.covered ?? [])
        .map((area) => {
          const x = (area.x - bounds.x) * sx + pad;
          const y = (area.y - bounds.y) * sy + pad;
          return `<rect x="${x}" y="${y}" width="${area.width * sx}" height="${area.height * sy}" fill="black"/>`;
        })
        .join("");
      cut.style.maskImage = holes
        ? `url("data:image/svg+xml,${encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width * sx + pad * 2}" height="${bounds.height * sy + pad * 2}"><mask id="cut"><rect width="100%" height="100%" fill="white"/>${holes}</mask><rect width="100%" height="100%" fill="white" mask="url(#cut)"/></svg>`,
          )}")`
        : "";
    } else cut.style.maskImage = "";
    const point = value.pointer;
    if (point && point.expiresAt > Date.now()) {
      const x = (point.x - screen.x) * sx;
      const y = (point.y - screen.y) * sy;
      if (
        x >= 0 &&
        y >= 0 &&
        x < container.clientWidth &&
        y < container.clientHeight
      ) {
        const next = { x: x - hotspot, y: y - hotspot };
        const changed = point.id !== action;
        if (changed || next.x !== destination?.x || next.y !== destination?.y) {
          const from =
            !cursor.hidden && new DOMMatrix(getComputedStyle(cursor).transform);
          playing?.cancel();
          playing = undefined;
          cursor.style.transform = `translate(${next.x}px,${next.y}px)`;
          const samples = point.motion;
          const duration = samples?.at(-1)?.t;
          if (changed && from && duration > 0 && !reducedMotion.matches) {
            const first = samples[0];
            const dx = from.m41 - ((first.x - screen.x) * sx - hotspot);
            const dy = from.m42 - ((first.y - screen.y) * sy - hotspot);
            playing = cursor.animate(
              samples.map((sample) => {
                const offset = sample.t / duration;
                return {
                  offset,
                  transform: `translate(${(sample.x - screen.x) * sx - hotspot + dx * (1 - offset)}px,${(sample.y - screen.y) * sy - hotspot + dy * (1 - offset)}px)`,
                };
              }),
              { duration: duration * 1000 },
            );
          }
          destination = next;
        }
        cursor.hidden = false;
        if (changed) {
          action = point.id;
          cursor.classList.remove("acting");
          const click = () => {
            if (
              point.id === action &&
              !cursor.hidden &&
              ["click", "double_click", "right_click"].includes(point.action)
            ) {
              void cursor.offsetWidth;
              cursor.classList.add("acting");
            }
          };
          if (playing) playing.onfinish = click;
          else click();
        }
        return;
      }
    }
    cursor.hidden = true;
    playing?.cancel();
    playing = destination = undefined;
  }
  const resize = new ResizeObserver(draw);
  resize.observe(container);
  return {
    update(value) {
      latest = value;
      clearTimeout(timer);
      draw();
      if (value)
        timer = setTimeout(
          () => this.update(null),
          Math.max(0, value.expiresAt - Date.now()),
        );
    },
    close() {
      clearTimeout(timer);
      playing?.cancel();
      resize.disconnect();
      root.replaceChildren();
    },
  };
}
