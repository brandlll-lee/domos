import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import { expect, test } from "vitest";
import { cursorTheme } from "../src/harness/cursor-theme.mjs";

test("Bot cursor themes preserve native geometry, animation and soft glow", async () => {
  const source = await readFile(
    new URL("../src/harness/cursor.lottie", import.meta.url),
  );
  const theme = cursorTheme(source, "#4dd9cc");
  expect(theme.source).toEqual(cursorTheme(source, "#4dd9cc").source);
  expect(theme.id).toBe("app.domos.cursor.c4dd9cc");
  const files = unzipSync(theme.source);
  const original = unzipSync(source);
  expect(Object.keys(files)).toEqual(Object.keys(original));
  const manifest = JSON.parse(
    strFromU8(files["cua/theme.json"] ?? new Uint8Array()),
  );
  expect(Object.keys(manifest.actions)).toHaveLength(12);
  expect(manifest.hotspot).toEqual({ x: 55, y: 30 });
  const idle = JSON.parse(
    strFromU8(files["a/action_idle.json"] ?? new Uint8Array()),
  );
  const base = JSON.parse(
    strFromU8(original["a/action_idle.json"] ?? new Uint8Array()),
  );
  expect(idle.layers.map((layer: { ks: unknown }) => layer.ks)).toEqual(
    base.layers.map((layer: { ks: unknown }) => layer.ks),
  );
  const body = idle.layers.find(
    (layer: { nm: string }) => layer.nm === "Cursor body",
  );
  expect(
    body.shapes.find((shape: { ty: string }) => shape.ty === "fl").c.k,
  ).toEqual([77 / 255, 217 / 255, 204 / 255, 1]);
  const glow = idle.layers.filter((layer: { nm: string }) =>
    layer.nm.startsWith("Cursor glow"),
  );
  expect(glow).toHaveLength(8);
  expect(
    glow.every(
      (layer: {
        shapes: { ty: string; c: { k: number[] }; o: { k: number } }[];
      }) => {
        const stroke = layer.shapes.find((shape) => shape.ty === "st");
        return stroke?.c.k[0] === 77 / 255 && stroke.o.k > 0 && stroke.o.k < 10;
      },
    ),
  ).toBe(true);
  expect(() => cursorTheme(source, "invalid")).toThrow("Invalid cursor color");
});
