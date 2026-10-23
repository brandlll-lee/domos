import { expect, test } from "vitest";
import {
  characterColors,
  characterIdentity,
  characterNames,
  characterSeed,
} from "../src/characters.ts";

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

test("all nine shapes and eighteen colors can be selected independently", () => {
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
  expect(identities.size).toBe(162);
  expect(characterIdentity(characterSeed("capsule", "#b39aff"))).toEqual({
    shape: "capsule",
    color: "#b39aff",
  });
});
