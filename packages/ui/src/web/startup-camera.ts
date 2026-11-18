type Point = { x: number; y: number };
type Curve = [Point, Point, Point, Point];
type Position = [number, number];
type Placement = [number, number, number];

const desktop = {
  width: 1000,
  height: 545,
  computer: [26, 53, 550] as Placement,
  bot: [35, 300, 174] as Placement,
  station: [656, 209, 285] as Placement,
  junction: [583, 337] as Position,
  choices: [
    [660, 244],
    [660, 379],
  ],
  single: [655, 339],
  engines: [
    [679, 49],
    [679, 108],
    [679, 167],
    [679, 226],
    [709, 337],
    [709, 395],
    [709, 453],
    [709, 511],
    [588, 281],
  ],
  forks: [
    [613, 145],
    [625, 421],
  ],
  hub: [566, 321] as Position,
  models: [
    [677, 230],
    [677, 315],
    [677, 400],
  ],
};
const phone = {
  width: 380,
  height: 622,
  computer: [25, 30, 320] as Placement,
  bot: [15, 197, 122] as Placement,
  station: [118, 321, 240] as Placement,
  junction: [83, 364] as Position,
  choices: [
    [126, 376],
    [126, 461],
  ],
  single: [126, 452],
  engines: [
    [31, 304],
    [31, 371],
    [31, 438],
    [31, 505],
    [207, 304],
    [207, 371],
    [207, 438],
    [207, 505],
    [108, 579],
  ],
  forks: [
    [16, 274],
    [191, 274],
  ],
  hub: [187, 272] as Position,
  models: [
    [127, 351],
    [127, 422],
    [127, 493],
  ],
};
const places = {
  home: [0, 0],
  engine: [1, -1],
  model: [2, -1.5],
  access: [3, -1.5],
  address: [1, 1],
  pair: [2, 1],
} as const;
export type StartupStop = keyof typeof places;

type Station = {
  id: StartupStop;
  column: number;
  element?: HTMLElement;
  branch: number;
};

function bend(
  start: Point,
  end: Point,
  firstX: number,
  firstY: number,
  secondX: number,
  secondY: number,
): Curve {
  return [
    start,
    { x: start.x + firstX, y: start.y + firstY },
    { x: end.x + secondX, y: end.y + secondY },
    end,
  ];
}

function pointAt(curve: Curve, progress: number) {
  const left = 1 - progress;
  const weights = [
    left ** 3,
    3 * left ** 2 * progress,
    3 * left * progress ** 2,
    progress ** 3,
  ];
  return curve.reduce(
    (point, control, index) => ({
      x: point.x + control.x * (weights[index] ?? 0),
      y: point.y + control.y * (weights[index] ?? 0),
    }),
    { x: 0, y: 0 },
  );
}

function noise(a: number, b: number) {
  const value = Math.sin(a * 31.416 + b * 17.231) * 43758.5453;
  return value - Math.floor(value);
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const glyphs = ".:;+=x#%@";

export function startupCamera(
  viewport: HTMLElement,
  world: HTMLElement,
  wires: HTMLCanvasElement,
) {
  const ink = wires.getContext("2d");
  if (!ink) throw new Error("Startup needs a 2D canvas.");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const theme = matchMedia("(prefers-color-scheme: dark)");
  const route: Station[] = [];
  let layout = desktop;
  let width = 0,
    height = 0,
    scale = 1;
  let camera = { x: 0, y: 0, zoom: 1 };
  let frame = 0;
  let since = performance.now();
  let trip:
    | {
        origin: Station;
        stations: Station[];
        reverse: boolean;
        started: number;
      }
    | undefined;
  let selected: HTMLElement | null = null;
  let hovered: HTMLElement | null = null;
  let returnHovered = false;
  let modelMotion:
    | { start: number; direction: number; duration: number; distance: number }
    | undefined;

  function center(station: Station) {
    const lane = places[station.id][1];
    return {
      x: station.column * layout.width * 1.13,
      y: lane * layout.height * 0.91,
    };
  }

  function coord(station: Station, point: readonly number[]) {
    const anchor = center(station);
    return {
      x: anchor.x - layout.width / 2 + (point[0] ?? 0),
      y: anchor.y - layout.height / 2 + (point[1] ?? 0),
    };
  }

  function computer(station: Station): Placement {
    return station.id === "engine" && layout === phone
      ? [25, 15, 320]
      : layout.computer;
  }

  function port(station: Station, x: number, y: number) {
    const [left, top, size] = computer(station);
    return coord(station, [left + (x * size) / 320, top + (y * size) / 320]);
  }

  function branches(station: Station) {
    return Array.from(
      station.element?.querySelectorAll<HTMLElement>(".startup-branch") ?? [],
    );
  }

  function positions(station: Station) {
    if (station.id === "home") return layout.choices;
    if (station.id === "engine") return layout.engines;
    if (station.id === "model") return layout.models;
    return [layout.single];
  }

  function indexOf(station: Station, button: HTMLElement, index: number) {
    return station.id === "model"
      ? Number(button.dataset.modelStep) + 1
      : index;
  }

  function delay(station: Station, index: number) {
    if (station.id === "engine")
      return index === 8
        ? 175
        : 100 + (index >= 4 ? 140 : 0) + (index % 4) * 55;
    return 65 + index * 120;
  }

  function place(station: Station) {
    const element = station.element;
    if (!element) return;
    const anchor = coord(station, [0, 0]);
    element.style.setProperty("--form-pin-y", `${layout.single[1]}px`);
    Object.assign(element.style, {
      left: `${anchor.x}px`,
      top: `${anchor.y}px`,
      width: `${layout.width}px`,
      height: `${layout.height}px`,
    });
    const bot =
      station.id === "engine" && layout === phone ? [22, 151, 122] : layout.bot;
    for (const [part, value] of [
      ["computer", computer(station)],
      ["bot", bot],
      ["station", layout.station],
    ] as const) {
      for (const [index, axis] of ["x", "y", "w"].entries()) {
        element.style.setProperty(`--${part}-${axis}`, `${value[index]}px`);
      }
    }
    for (const [index, button] of branches(station).entries()) {
      const slot = indexOf(station, button, index);
      const position = positions(station)[slot];
      if (!position) continue;
      button.style.setProperty("--choice-x", `${position[0]}px`);
      button.style.setProperty("--choice-y", `${position[1]}px`);
      button.style.setProperty("--delay", `${delay(station, slot) + 100}ms`);
    }
  }

  function pin(station: Station, slot: number, offset = 0) {
    const [x = 0, y = 0] = positions(station)[slot] ?? layout.single;
    return coord(station, [x + 8, y + offset]);
  }

  function stationWires(station: Station, offset: number) {
    const socket = port(station, 257, 180);
    const buttons = branches(station);
    if (station.id === "engine") {
      const hub = coord(station, layout.hub);
      const upper = coord(station, layout.forks[0] ?? []);
      const lower = coord(station, layout.forks[1] ?? []);
      const compact = layout === phone;
      const trunk = compact
        ? [
            bend(socket, hub, 64, 66, 81, -48),
            ...[upper, lower].map((fork) => bend(hub, fork, -24, 6, 30, -8)),
          ]
        : [
            bend(socket, hub, 21, 40, -24, 22),
            bend(hub, upper, 39, -38, -10, 58),
            bend(hub, lower, 44, 8, -23, -16),
          ];
      const lines = buttons.map((_, index) => {
        const end = pin(station, index);
        if (index === 8) {
          const start = compact ? coord(station, [189, 506]) : hub;
          if (compact) trunk.push(bend(hub, start, 1, 64, 1, -68));
          return compact
            ? bend(start, end, 0, 52, -16, 0)
            : bend(hub, end, 20, -12, -12, 12);
        }
        const fork = index < 4 ? upper : lower;
        return compact
          ? bend(fork, end, 3, (end.y - fork.y) * 0.8, -23, -5)
          : bend(fork, end, 30, (end.y - fork.y) * 0.45, -40, 2);
      });
      return { trunk, lines, buttons };
    }
    const junction = coord(station, layout.junction);
    const pins = buttons.map((button, index) => {
      const slot = indexOf(station, button, index);
      return pin(
        station,
        slot,
        station.id === "model" ? offset * (slot === 1 ? 1 : 0.75) : 0,
      );
    });
    if (layout === phone) {
      const sag = coord(station, [255, 303]);
      return {
        trunk: [
          bend(socket, sag, 52, 49, 80, -22),
          bend(sag, junction, -107, -22, 13, -53),
        ],
        lines: pins.map((end) => bend(junction, end, -19, 44, -34, 5)),
        buttons,
      };
    }
    return {
      trunk: [bend(socket, junction, 44, 10, -40, 47)],
      lines: pins.map((end) => bend(junction, end, 26, -17, -40, 7)),
      buttons,
    };
  }

  function between(source: Station, target: Station) {
    return bend(
      pin(source, target.branch),
      port(target, 37, 211),
      layout.width * 0.16,
      12,
      -layout.width * 0.18,
      -28,
    );
  }

  function cable(
    context: CanvasRenderingContext2D,
    curve: Curve,
    powered: boolean,
    limit = 1,
    strength = 1,
    pulse?: number,
  ) {
    const zoom = scale * camera.zoom;
    const distance = Math.hypot(
      curve[3].x - curve[0].x,
      curve[3].y - curve[0].y,
    );
    const cells = Math.max(15, Math.ceil(distance / 4.2));
    const conductor = theme.matches ? "#a2a297" : "#434240";
    const weave = theme.matches ? "#d2bd92" : "#6b5c48";
    const signal = theme.matches ? "#b9f47b" : "#57752c";
    const pixel = layout === phone ? 3 : 3.25;
    context.font = `bold ${Math.max(5, 8 * zoom)}px Consolas, monospace`;
    for (let cell = 0; cell <= cells * limit; cell++) {
      const along = cell / cells;
      const sample = pointAt(curve, along);
      const x = width / 2 + (sample.x - camera.x) * zoom;
      const y = height / 2 + (sample.y - camera.y) * zoom;
      if (x < -9 || x > width + 9 || y < -9 || y > height + 9) continue;
      const seed = noise(cell + distance, curve[0].x);
      const column = Math.round(x / pixel) * pixel;
      const row = Math.round(y / pixel) * pixel;
      const live =
        powered &&
        (pulse === undefined || (along <= pulse && along >= pulse - 0.23));
      context.globalAlpha = (live ? 0.96 : 0.58) * strength;
      context.fillStyle = live ? signal : cell % 4 ? conductor : weave;
      context.fillRect(column, row, pixel, pixel);
      if (seed > 0.43) {
        context.globalAlpha = (live ? 0.66 : 0.36) * strength;
        context.fillStyle = live ? signal : weave;
        context.fillText(
          glyphs[Math.floor(seed * glyphs.length)] ?? ".",
          column + 1,
          row + pixel + 2,
        );
      }
      if (live && seed > 0.78) {
        context.globalAlpha = 0.91 * strength;
        context.fillText("+", column, row - 1);
      }
    }
    context.globalAlpha = 1;
  }

  function atRest(station: Station, time: number) {
    camera = { ...center(station), zoom: 1 };
    since = time;
    trip?.origin.element?.remove();
    trip = undefined;
    viewport.removeAttribute("data-travelling");
    station.element?.removeAttribute("inert");
    station.element?.setAttribute("data-active", "");
    station.element?.querySelector("h1")?.focus({ preventScroll: true });
    if (station.id === "model" && !reduced.matches)
      modelMotion = {
        start: time + 650,
        direction: 1,
        duration: 480,
        distance: 8,
      };
  }

  function draw(time: number) {
    frame = 0;
    const active = route.at(-1);
    if (!active || !ink) return;
    let movement = 1;
    let pulse: number | undefined;
    const moving = trip;
    if (moving) {
      const { stations, reverse } = moving;
      const elapsed = Math.max(0, time - moving.started);
      movement = reduced.matches ? 1 : clamp((elapsed - 150) / 1040);
      pulse = reverse ? 1.16 - elapsed / 690 : Math.min(1.23, elapsed / 690);
      const approach = movement * movement * (3 - 2 * movement);
      const distance =
        (reverse ? 1 - approach : approach) * (stations.length - 1);
      const index = Math.min(stations.length - 2, Math.floor(distance));
      const progress = distance - index;
      const source = stations[index];
      const target = stations[index + 1];
      if (!source || !target) return;
      const curve = between(source, target);
      const [first, , , last] = curve;
      const point = pointAt(curve, progress);
      const from = center(source),
        to = center(target);
      camera = {
        x:
          point.x +
          (from.x - first.x) * (1 - progress) +
          (to.x - last.x) * progress,
        y:
          point.y +
          (from.y - first.y) * (1 - progress) +
          (to.y - last.y) * progress,
        zoom: 1 + Math.sin(Math.PI * approach) * 0.19,
      };
      if (movement === 1) atRest(active, time);
    }
    const zoom = scale * camera.zoom;
    world.style.transform = `translate(${width / 2}px,${height / 2}px) scale(${zoom}) translate(${-camera.x}px,${-camera.y}px)`;
    ink.clearRect(0, 0, width, height);
    const focus =
      active.element?.querySelector<HTMLElement>(
        ".startup-branch[aria-current=true]",
      ) ?? null;
    const powered = trip ? null : (hovered ?? focus);
    if (powered !== selected) {
      selected?.removeAttribute("data-powered");
      powered?.setAttribute("data-powered", "");
      selected = powered;
    }
    const phase = modelMotion
      ? Math.max(0, (time - modelMotion.start) / modelMotion.duration)
      : 1;
    const offset =
      modelMotion && phase < 1 && !reduced.matches
        ? Math.sin(phase * Math.PI) *
          modelMotion.direction *
          modelMotion.distance
        : 0;
    if (phase >= 1) modelMotion = undefined;
    active.element?.style.setProperty("--model-offset", `${offset}px`);
    for (const [index, station] of route.entries()) {
      const previous = route[index - 1];
      if (!previous) continue;
      const connecting = trip && station === active && !trip.reverse;
      cable(
        ink,
        between(previous, station),
        Boolean(connecting || (station === active && returnHovered)),
        connecting ? clamp(Math.max(pulse ?? 0, movement * 1.6)) : 1,
        1,
        connecting ? pulse : undefined,
      );
    }
    if (trip?.reverse) {
      const legCount = trip.stations.length - 1;
      for (const [index, target] of trip.stations.entries()) {
        const source = trip.stations[index - 1];
        if (source)
          cable(
            ink,
            between(source, target),
            true,
            1,
            1,
            (pulse ?? 0) * legCount - index + 1,
          );
      }
    }
    for (const station of [active, trip?.origin]) {
      if (!station) continue;
      const { trunk, lines, buttons } = stationWires(
        station,
        station === active ? offset : 0,
      );
      const settled = Boolean(trip || reduced.matches);
      for (const line of trunk)
        cable(
          ink,
          line,
          false,
          settled ? 1 : Math.max(0.12, clamp((time - since) / 270)),
          0.76,
        );
      for (const [index, line] of lines.entries()) {
        const button = buttons[index];
        if (!button) continue;
        const slot = indexOf(station, button, index);
        const reach = settled
          ? 1
          : clamp((time - since - delay(station, slot)) / 220);
        const live =
          button === powered ||
          (trip?.origin === station && button.hasAttribute("data-powered"));
        if (reach)
          cable(
            ink,
            line,
            live,
            reach,
            station.id !== "model" || slot === 1 || live ? 1 : 0.7,
          );
      }
    }
    if (trip || modelMotion || (!reduced.matches && time - since < 650))
      request();
  }

  function request() {
    if (!frame) frame = requestAnimationFrame(draw);
  }

  function resize() {
    const pixelRatio = Math.min(devicePixelRatio, 2);
    width = viewport.clientWidth;
    height = viewport.clientHeight;
    layout = width < 670 ? phone : desktop;
    scale = Math.min(1.32, width / layout.width, height / layout.height);
    wires.width = Math.round(width * pixelRatio);
    wires.height = Math.round(height * pixelRatio);
    ink?.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    viewport.toggleAttribute("data-compact", layout === phone);
    for (const station of route) place(station);
    if (trip) place(trip.origin);
    else {
      const active = route.at(-1);
      if (active) camera = { ...center(active), zoom: 1 };
    }
    request();
  }

  function hit(event: PointerEvent | MouseEvent) {
    if (
      !ink ||
      trip ||
      route.length < 2 ||
      (event.target instanceof Element &&
        event.target.closest(
          "button,input,.startup-computer,.startup-station form",
        ))
    )
      return false;
    const from = route[route.length - 2],
      to = route.at(-1);
    if (!from || !to) return false;
    const [start, first, second, end] = between(from, to);
    const path = new Path2D();
    path.moveTo(start.x, start.y);
    path.bezierCurveTo(first.x, first.y, second.x, second.y, end.x, end.y);
    const rect = viewport.getBoundingClientRect();
    const zoom = scale * camera.zoom;
    ink.save();
    ink.resetTransform();
    ink.lineWidth = 30 / zoom;
    ink.lineCap = "round";
    const result = ink.isPointInStroke(
      path,
      (event.clientX - rect.left - width / 2) / zoom + camera.x,
      (event.clientY - rect.top - height / 2) / zoom + camera.y,
    );
    ink.restore();
    return result;
  }

  const observer = new ResizeObserver(resize);
  observer.observe(viewport);
  const branchesChanged = new MutationObserver(() => {
    const active = route.at(-1);
    if (active) place(active);
    request();
  });
  branchesChanged.observe(world, { childList: true, subtree: true });
  const browse = (event: Event) => {
    if (event instanceof CustomEvent && typeof event.detail === "number") {
      modelMotion = {
        start: performance.now(),
        direction: event.detail,
        duration: 240,
        distance: 12,
      };
      request();
    }
  };
  viewport.addEventListener("startup:browse", browse);
  theme.addEventListener("change", request);
  reduced.addEventListener("change", request);

  return {
    show(
      id: StartupStop,
      element: HTMLElement,
      prior?: HTMLElement,
      choice?: number,
    ) {
      const origin = route.at(-1);
      if (origin?.id === id) {
        place(origin);
        request();
        return;
      }
      if (trip && origin) atRest(origin, performance.now());
      const previous = route.findLastIndex((station) => station.id === id);
      const reverse = previous >= 0;
      const column =
        id === "access"
          ? 2
          : id === "model" && origin?.id === "access"
            ? 3
            : places[id][0];
      const destination = {
        id,
        column: route[previous]?.column ?? column,
        element,
        branch: reverse ? (route[previous]?.branch ?? 0) : (choice ?? 0),
      };
      if (!origin && (id === "engine" || id === "pair")) {
        const entry = id === "engine" ? "home" : "address";
        route.push({ id: entry, column: places[entry][0], branch: 0 });
      }
      const stations = reverse
        ? [destination, ...route.slice(previous + 1)]
        : origin
          ? [origin, destination]
          : [];
      if (reverse) route.splice(previous, route.length - previous, destination);
      else route.push(destination);
      if (origin) {
        origin.element = prior;
        if (prior) {
          prior.inert = true;
          prior.setAttribute("aria-hidden", "true");
          prior.setAttribute("data-outgoing", "");
          world.prepend(prior);
        }
      }
      hovered = null;
      this.returnHover(false);
      modelMotion = undefined;
      if (origin && !reduced.matches) {
        element.inert = true;
        viewport.setAttribute("data-travelling", "");
        trip = { origin, stations, reverse, started: performance.now() };
      }
      resize();
      if (!trip) {
        prior?.remove();
        atRest(destination, performance.now());
      }
      request();
    },
    preview(button: HTMLElement | null) {
      hovered = button;
      request();
    },
    returnHover(active: boolean) {
      returnHovered = active;
      viewport.toggleAttribute("data-return-hover", active);
      request();
    },
    hit,
    dispose() {
      observer.disconnect();
      branchesChanged.disconnect();
      viewport.removeEventListener("startup:browse", browse);
      theme.removeEventListener("change", request);
      reduced.removeEventListener("change", request);
      cancelAnimationFrame(frame);
    },
  };
}
