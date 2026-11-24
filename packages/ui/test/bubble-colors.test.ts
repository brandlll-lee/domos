import { expect, test } from "vitest";
import { userBubbleColors } from "../src/bubble-colors.ts";
import { characterColors } from "../src/characters.ts";
import { themes } from "../src/tokens.ts";

function contrast(ink: string, fill: string) {
  const luminance = (color: string) => {
    const channels = [1, 3, 5].map((i) => {
      const value = Number.parseInt(color.slice(i, i + 2), 16) / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels.reduce(
      (sum, value, index) =>
        sum + value * ([0.2126, 0.7152, 0.0722][index] ?? 0),
      0,
    );
  };
  const a = luminance(ink),
    b = luminance(fill);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test("qualifying colors retain their exact identity and saturation", () => {
  expect(userBubbleColors("#894ef0").light).toBe("#894ef0");
  for (const color of ["#73479f", "#0000ff", "#123456", "#000000"])
    expect(userBubbleColors(color)).toEqual({ light: color, dark: color });
});

test("a bright blue reaches AA while retaining its hue and chroma", () => {
  expect(userBubbleColors("#659fff").light).toBe("#3d75d1");
});

test("theme ink controls contrast and qualifying original colors stay unchanged", () => {
  const colors: string[] = characterColors.map(({ color }) => color);
  for (let r = 0; r <= 255; r += 17)
    for (let g = 0; g <= 255; g += 17)
      for (let b = 0; b <= 255; b += 17)
        colors.push(
          `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`,
        );
  for (const color of colors) {
    const palette = userBubbleColors(color);
    for (const theme of ["light", "dark"] as const) {
      const ink = themes[theme]["user-text"];
      expect(
        contrast(ink, palette[theme]),
        `${theme} ${color}`,
      ).toBeGreaterThanOrEqual(4.5);
      if (contrast(ink, color) >= 4.5) expect(palette[theme]).toBe(color);
      else
        expect(contrast(ink, palette[theme]), `${theme} ${color}`).toBeLessThan(
          4.65,
        );
    }
  }
});

test("theme colors require six-digit HEX input", () => {
  for (const color of ["#fff", "red", "#12345g", "#ffffffff"])
    expect(() => userBubbleColors(color)).toThrow(
      "Expected six-digit HEX color",
    );
});
