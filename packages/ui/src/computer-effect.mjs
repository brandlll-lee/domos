export function mountComputerEffect(container) {
  const root = container.shadowRoot ?? container.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    :host{position:absolute;inset:0;pointer-events:none;overflow:hidden;contain:strict}
    *{box-sizing:border-box}
    .rim{position:absolute;border-radius:var(--radius-panel,16px);box-shadow:inset 0 0 0 2px var(--bot-color),inset 0 0 40px -8px color-mix(in srgb,var(--bot-color) 65%,transparent),inset 0 0 96px -16px color-mix(in srgb,var(--bot-color) 30%,transparent)}
    .cursor{position:absolute;left:0;top:0;width:28px;height:32px;filter:drop-shadow(0 2px 3px #0006);transition:transform 180ms cubic-bezier(.22,.68,0,1)}
    .cursor svg{width:100%;height:100%;overflow:visible}
    .cursor path{fill:var(--bot-color);stroke:#fff;stroke-width:1.5;stroke-linejoin:round}
    .pulse{fill:none;stroke:var(--bot-color);stroke-width:2;transform-origin:5px 5px}
    .acting .pulse{animation:click 400ms ease-out}
    @keyframes click{from{transform:scale(.2);opacity:1}to{transform:scale(2);opacity:0}}
    @media(prefers-reduced-motion:reduce){.cursor{transition:none}.acting .pulse{animation:none}}
    @media(forced-colors:active){.rim{box-shadow:inset 0 0 0 2px Highlight}.cursor path{fill:Highlight;stroke:Canvas}}
  </style><div class="rim" hidden></div><div class="cursor" hidden><svg viewBox="0 0 28 32" aria-hidden="true"><circle class="pulse" cx="5" cy="5" r="7"/><path d="M5 3 5 25 11 19 16 29 21 27 16 17 25 16Z"/></svg></div>`;
  container.setAttribute("aria-hidden", "true");
  const rim = root.querySelector(".rim");
  const cursor = root.querySelector(".cursor");
  let timer;
  let action;
  let latest;
  function draw() {
    const value = latest;
    rim.hidden = cursor.hidden = true;
    if (!value || value.expiresAt <= Date.now()) return;
    const screen = value.screen;
    if (!screen || screen.width <= 0 || screen.height <= 0) return;
    const sx = container.clientWidth / screen.width;
    const sy = container.clientHeight / screen.height;
    container.style.setProperty("--bot-color", value.color);
    const bounds = value.window;
    if (bounds) {
      rim.hidden = false;
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
        cursor.hidden = false;
        cursor.style.transform = `translate(${x - 5}px,${y - 3}px)`;
        if (point.id !== action) {
          action = point.id;
          cursor.classList.remove("acting");
          if (point.action === "click" || point.action === "drag") {
            void cursor.offsetWidth;
            cursor.classList.add("acting");
          }
        }
      }
    }
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
      resize.disconnect();
      root.replaceChildren();
    },
  };
}
