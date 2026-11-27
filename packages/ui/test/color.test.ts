import { expect, test } from "vitest";
import { hexOf, hsvHex, hsvOf, rgbOf } from "../src/color.ts";

test("color channels round-trip through RGB and HSV including neutral colors", () => {
  for (const hex of [
    "#000000",
    "#ffffff",
    "#ff0000",
    "#00ff00",
    "#0000ff",
    "#73479f",
    "#d65358",
  ]) {
    expect(hexOf(rgbOf(hex))).toBe(hex);
    expect(hsvHex(hsvOf(hex))).toBe(hex);
  }
  expect(hsvOf("#808080", 240).h).toBe(240);
  expect(hsvOf("#000000", 120)).toEqual({ h: 120, s: 0, v: 0 });
  expect(hsvHex({ h: 360, s: 1, v: 1 })).toBe("#ff0000");
});
