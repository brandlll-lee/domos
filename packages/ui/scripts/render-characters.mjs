import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { characterBaseColor, characterShapes } from "../src/characters.ts";

const output = fileURLToPath(new URL("../assets/characters/", import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const selected = process.argv.slice(3);
  const outlines = await page.evaluate(
    ({ shapes, selected }) => {
      return Object.entries(shapes)
        .filter(([name]) => !selected.length || selected.includes(name))
        .map(([name, path]) => {
          const element = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "path",
          );
          element.setAttribute("d", path);
          const length = element.getTotalLength();
          const count = Math.ceil(length * 4);
          const points = Array.from({ length: count }, (_, index) => {
            const point = element.getPointAtLength((length * index) / count);
            return [point.x, point.y];
          });
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 2048;
          const context = canvas.getContext("2d");
          context.scale(20.48, 20.48);
          context.fill(new Path2D(path), "nonzero");
          return {
            name,
            points,
            mask: canvas.toDataURL("image/png").split(",")[1],
          };
        });
    },
    { shapes: characterShapes, selected },
  );
  const result = spawnSync(
    process.argv[2] ?? "python",
    [fileURLToPath(new URL("./render-characters.py", import.meta.url)), output],
    {
      input: JSON.stringify({ color: characterBaseColor, outlines }),
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error("Character textures could not be rendered.");
} finally {
  await browser.close();
}
