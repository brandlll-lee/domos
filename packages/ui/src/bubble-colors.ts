import { themes } from "./tokens.ts";

type Channels = [number, number, number];

const linear = (value: number) =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

function channels(color: string): Channels {
  if (!/^#[\da-f]{6}$/i.test(color))
    throw new Error("Expected six-digit HEX color");
  const value = Number.parseInt(color.slice(1), 16);
  return [value >> 16, (value >> 8) & 255, value & 255].map((v) =>
    linear(v / 255),
  ) as Channels;
}

const luminance = ([r, g, b]: Channels) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function oklch([r, g, b]: Channels): Channels {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    Math.hypot(a, bb),
    Math.atan2(bb, a),
  ];
}

function rgb(l: number, c: number, h: number): Channels {
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const lc = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mc = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sc = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
    -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
    -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc,
  ];
}

function hex(l: number, c: number, h: number): string {
  const fits = (value: number) =>
    rgb(l, value, h).every((v) => v >= 0 && v <= 1);
  if (!fits(c)) {
    let lo = 0;
    let hi = c;
    for (let step = 0; step < 24; step++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    c = lo;
  }
  return `#${rgb(l, c, h)
    .map((v) => {
      const x = Math.max(0, Math.min(1, v));
      const encoded =
        x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055;
      return Math.round(encoded * 255)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
}

function fill(color: string, ink: string): string {
  const original = channels(color);
  const foreground = luminance(channels(ink));
  const readable = (background: Channels) => {
    const value = luminance(background);
    return (
      (Math.max(foreground, value) + 0.05) /
        (Math.min(foreground, value) + 0.05) >=
      4.5
    );
  };
  if (readable(original)) return color;
  const [l, c, h] = oklch(original);
  let lo = 0;
  let hi = l;
  let best = "#000000";
  // Check rounded sRGB output so the displayed color meets the contrast target.
  for (let step = 0; step < 24; step++) {
    const mid = (lo + hi) / 2;
    const candidate = hex(mid, c, h);
    if (readable(channels(candidate))) {
      best = candidate;
      lo = mid;
    } else hi = mid;
  }
  return best;
}

export function userBubbleColors(color: string) {
  return {
    light: fill(color, themes.light["user-text"]),
    dark: fill(color, themes.dark["user-text"]),
  };
}
