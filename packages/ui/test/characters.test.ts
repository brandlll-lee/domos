import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import {
  type CharacterShape,
  characterColors,
  characterIdentity,
  characterNames,
  characterSeed,
} from "../src/characters.ts";
import { Character } from "../src/web/character.tsx";

test("plush shading retains the Bot color at the calibrated material midpoint", () => {
  for (const { color } of characterColors) {
    const html = renderToStaticMarkup(
      createElement(Character, { shape: "cloud", color, state: "idle" }),
    );
    const tables = [...html.matchAll(/tableValues="([^"]+)"/g)].map((match) =>
      (match[1] ?? "").split(" ").map(Number),
    );
    expect(tables).toHaveLength(3);
    tables.forEach((table, channel) => {
      expect(table).toHaveLength(256);
      const ink =
        Number.parseInt(color.slice(1 + channel * 2, 3 + channel * 2), 16) /
        255;
      expect(Math.abs((table[140] ?? 0) - ink)).toBeLessThan(1 / 255);
      expect(table[0]).toBe(0);
      table.forEach((value, index) => {
        expect(value).toBeGreaterThanOrEqual(table[index - 1] ?? 0);
        expect(value).toBeLessThanOrEqual(1);
      });
    });
  }
});

test("saved identities retain their shape and color", () => {
  expect(characterIdentity("00000000-0000-4000-8000-000000000001")).toEqual({
    shape: "heart",
    color: "#b39aff",
  });
  expect(characterIdentity("3013be2d-b9db-4d31-aef1-2f55521e20aa")).toEqual({
    shape: "soft",
    color: "#4bdec2",
  });
  expect(characterIdentity("Domos")).toEqual({
    shape: "star",
    color: "#f5c85a",
  });
});

test("plush padding retains the body coordinate frame and independent eyes", () => {
  for (const shape of [
    "cat",
    ...Object.keys(characterNames),
  ] as CharacterShape[]) {
    const html = renderToStaticMarkup(
      createElement(Character, { shape, color: "#91df74", state: "idle" }),
    );
    expect(html).toContain(
      'x="-4.6875" y="-4.6875" width="109.375" height="109.375"',
    );
    expect(html).toContain('class="character-face"');
    expect(html.match(/class="character-eyelid"/g)).toHaveLength(2);
    expect(html).toContain('class="character-pupils"');
  }
});

test("all fifteen shapes and eighteen colors can be selected independently", () => {
  const identities = new Set<string>();
  for (const shape of Object.keys(
    characterNames,
  ) as (keyof typeof characterNames)[]) {
    for (const { color } of characterColors) {
      const seed = characterSeed(shape, color);
      expect(characterIdentity(seed)).toEqual({ shape, color });
      identities.add(seed);
    }
  }
  expect(identities.size).toBe(270);
  expect(characterIdentity(characterSeed("capsule", "#b39aff"))).toEqual({
    shape: "capsule",
    color: "#b39aff",
  });
});

test("saved shape numbers retain their identities as the catalog grows", () => {
  expect(characterIdentity("d0900008-0000-8000-8000-c6e95b000000")).toEqual({
    shape: "cloud",
    color: "#c6e95b",
  });
  expect(characterIdentity("d0900009-0000-8000-8000-f69dd1000000")).toEqual({
    shape: "bunny",
    color: "#f69dd1",
  });
});
