export type Hsv = { h: number; s: number; v: number };

export function rgbOf(hex: string): [number, number, number] {
  return [1, 3, 5].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16),
  ) as [number, number, number];
}

export function hexOf(rgb: readonly number[]): string {
  return `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

export function hsvOf(hex: string, previousHue = 0): Hsv {
  const [r, g, b] = rgbOf(hex).map((value) => value / 255) as [
    number,
    number,
    number,
  ];
  const v = Math.max(r, g, b);
  const delta = v - Math.min(r, g, b);
  let h = previousHue;
  if (delta) {
    h =
      60 *
      (v === r
        ? (g - b) / delta
        : v === g
          ? (b - r) / delta + 2
          : (r - g) / delta + 4);
    h = (h + 360) % 360;
  }
  return { h, s: v ? delta / v : 0, v };
}

export function hsvHex({ h, s, v }: Hsv): string {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6;
    return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return hexOf([channel(5), channel(3), channel(1)]);
}
