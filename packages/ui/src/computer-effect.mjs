export function mountComputerEffect(container) {
  const root = container.shadowRoot ?? container.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    :host{position:absolute;inset:0;pointer-events:none;overflow:hidden;contain:strict}
    *{box-sizing:border-box}
    .rim{position:absolute;border-radius:var(--radius-panel,16px);box-shadow:inset 0 0 0 2px var(--bot-color),inset 0 0 40px -8px color-mix(in srgb,var(--bot-color) 65%,transparent),inset 0 0 96px -16px color-mix(in srgb,var(--bot-color) 30%,transparent)}
    .cursor{position:absolute;left:0;top:0;width:28px;height:32px;filter:drop-shadow(0 2px 3px #0006)}
    .cursor svg{width:100%;height:100%;overflow:visible}
    .cursor path{fill:var(--bot-color);stroke:#fff;stroke-width:1.5;stroke-linejoin:round}
    .pulse{fill:none;stroke:var(--bot-color);stroke-width:2;transform-origin:5px 5px;opacity:0}
    .acting .pulse{animation:click 400ms ease-out}
    @keyframes click{from{transform:scale(.2);opacity:1}to{transform:scale(2);opacity:0}}
    @media(prefers-reduced-motion:reduce){.acting .pulse{animation:none}}
    @media(forced-colors:active){.rim{box-shadow:inset 0 0 0 2px Highlight}.cursor path{fill:Highlight;stroke:Canvas}}
  </style><div class="rim" hidden></div><div class="cursor" hidden><svg viewBox="0 0 28 32" aria-hidden="true"><circle class="pulse" cx="5" cy="5" r="7"/><path d="M5 3 5 25 11 19 16 29 21 27 16 17 25 16Z"/></svg></div>`;
  container.setAttribute("aria-hidden", "true");
  const rim = root.querySelector(".rim");
  const cursor = root.querySelector(".cursor");
  let timer;
  let action;
  let latest;
  let playing;
  let destination;
  const reducedMotion = matchMedia("(prefers-reduced-motion:reduce)");
  function hide() {
    rim.hidden = cursor.hidden = true;
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
      const holes = (value.covered ?? [])
        .map((area) => {
          const x = (area.x - bounds.x) * sx;
          const y = (area.y - bounds.y) * sy;
          return `<rect x="${x}" y="${y}" width="${area.width * sx}" height="${area.height * sy}" fill="black"/>`;
        })
        .join("");
      const mask = `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width * sx}" height="${bounds.height * sy}"><mask id="cut"><rect width="100%" height="100%" fill="white"/>${holes}</mask><rect width="100%" height="100%" fill="white" mask="url(#cut)"/></svg>`;
      rim.style.maskImage = `url("data:image/svg+xml,${encodeURIComponent(mask)}")`;
    }
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
        const next = { x: x - 5, y: y - 3 };
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
            const dx = from.m41 - ((first.x - screen.x) * sx - 5);
            const dy = from.m42 - ((first.y - screen.y) * sy - 3);
            playing = cursor.animate(
              samples.map((sample) => {
                const offset = sample.t / duration;
                return {
                  offset,
                  transform: `translate(${(sample.x - screen.x) * sx - 5 + dx * (1 - offset)}px,${(sample.y - screen.y) * sy - 3 + dy * (1 - offset)}px)`,
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
