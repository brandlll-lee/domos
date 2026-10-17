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
  const outlines = await page.evaluate((shapes) => {
    return Object.entries(shapes).map(([name, path]) => {
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
      return { name, points };
    });
  }, characterShapes);
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
