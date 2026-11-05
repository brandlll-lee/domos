import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

test("welcome characters keep their layout while they follow and greet", async ({
  playwright,
}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), "domos-avatars-"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const desktop = await playwright._electron.launch({
    executablePath: createRequire(new URL("../package.json", import.meta.url))(
      "electron",
    ) as string,
    args: [
      fileURLToPath(new URL("./entry.mjs", import.meta.url)),
      `--test-data-dir=${directory}`,
    ],
    env,
  });
  try {
    const page = await desktop.firstWindow();
    const team = page.getByRole("group", { name: "Domos 角色" });
    const buttons = team.getByRole("button");
    await expect(buttons).toHaveCount(7);
    for (const svg of await team.locator("svg").all())
      await expect(svg).toHaveAttribute("opacity", "1");
    await page.emulateMedia({ reducedMotion: "reduce" });
    const measure = () =>
      buttons.evaluateAll((nodes) =>
        nodes.map((node) => {
          const r = node.getBoundingClientRect();
          return {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            center: r.y + r.height / 2,
          };
        }),
      );
    const layout = await measure();
    expect(
      Math.max(...layout.map((r) => r.center)) -
        Math.min(...layout.map((r) => r.center)),
    ).toBeLessThan(1);
    const gaps = layout
      .slice(1)
      .map((r, i) => r.x - (layout[i]?.x ?? 0) - (layout[i]?.width ?? 0));
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1);
    expect(layout[3]?.width).toBeGreaterThan(
      Math.max(...layout.filter((_, i) => i !== 3).map((r) => r.width)),
    );
    const hero = page.getByRole("button", {
      name: "向Domos打招呼",
      exact: true,
    });
    const gesture = hero.locator(".character-gesture");
    await expect(gesture).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    await hero.click();
    await expect(gesture).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const bounds = await hero.boundingBox();
    if (!bounds) throw new Error("Main character is missing");
    const gaze = () =>
      hero.evaluate((node) =>
        Number.parseFloat(node.style.getPropertyValue("--character-gaze-x")),
      );
    await page.mouse.move(bounds.x - 200, bounds.y + bounds.height / 2);
    await expect.poll(gaze).toBeLessThan(-0.3);
    await page.mouse.move(
      bounds.x + bounds.width + 200,
      bounds.y + bounds.height / 2,
    );
    await expect.poll(gaze).toBeGreaterThan(0.3);
    await page.mouse.move(
      bounds.x + bounds.width * 0.8,
      bounds.y + bounds.height * 0.6,
    );
    await page.mouse.down();
    await expect
      .poll(() =>
        gesture.evaluate(
          (node) => new DOMMatrix(getComputedStyle(node).transform).d,
        ),
      )
      .toBeLessThan(0.98);
    await page.mouse.move(5, 5);
    await expect
      .poll(() =>
        gesture.evaluate(
          (node) => new DOMMatrix(getComputedStyle(node).transform).d,
        ),
      )
      .toBeGreaterThan(0.995);
    await page.mouse.up();
    await hero.focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(() =>
        gesture.evaluate(
          (node) => new DOMMatrix(getComputedStyle(node).transform).f,
        ),
      )
      .toBeLessThan(-0.2);
    await expect(hero).toBeFocused();
    await hero.click({ clickCount: 4 });
    const frames = await page.evaluate(async () => {
      const button = document.querySelector<HTMLButtonElement>(
        '.character-team button[aria-label="向Domos打招呼"]',
      );
      const samples: { x: number; y: number; scale: number }[] = [];
      for (let i = 0; i < 50; i++) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        const node = button?.querySelector(".character-gesture");
        if (!node) throw new Error("Character gesture is missing");
        const m = new DOMMatrix(getComputedStyle(node).transform);
        samples.push({ x: m.e, y: m.f, scale: m.d });
      }
      return samples;
    });
    expect(
      frames.every(
        (f) =>
          Number.isFinite(f.y) &&
          Math.abs(f.y) < 20 &&
          f.scale > 0.8 &&
          f.scale < 1.2,
      ),
    ).toBe(true);
    expect(
      Math.max(...frames.map((f) => f.y)) - Math.min(...frames.map((f) => f.y)),
    ).toBeGreaterThan(0.2);
    expect(await measure()).toEqual(layout);
    await page.mouse.move(-20, -20);
    await expect.poll(async () => Math.abs(await gaze())).toBeLessThan(0.01);
    await hero.hover();
    await hero.dispatchEvent("pointerdown", {
      pointerType: "touch",
      button: 0,
    });
    await expect
      .poll(() =>
        gesture.evaluate(
          (node) => new DOMMatrix(getComputedStyle(node).transform).d,
        ),
      )
      .toBeLessThan(0.98);
    await hero.dispatchEvent("pointercancel", { pointerType: "touch" });
    await expect
      .poll(() =>
        gesture.evaluate(
          (node) => new DOMMatrix(getComputedStyle(node).transform).d,
        ),
      )
      .toBeGreaterThan(0.995);
    await hero.evaluate((node) => node.blur());
    for (const colorScheme of ["dark", "light"] as const) {
      await desktop.evaluate(({ BrowserWindow, nativeTheme }, theme) => {
        nativeTheme.themeSource = theme;
        BrowserWindow.getAllWindows()[0]?.setSize(1280, 920);
      }, colorScheme);
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.screenshot({
        path: testInfo.outputPath(`welcome-${colorScheme}.png`),
        scale: "css",
      });
    }
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(390, 650),
    );
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(400);
    expect(
      await page
        .locator("main")
        .evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await expect(buttons.nth(0)).toBeInViewport();
    await expect(buttons.nth(6)).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath("welcome-narrow.png"),
      scale: "css",
    });
    await hero.dispatchEvent("pointerdown", {
      pointerType: "touch",
      button: 0,
    });
    await hero.dispatchEvent("pointercancel", { pointerType: "touch" });
    await expect(gesture).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    await writeFile(
      testInfo.outputPath("motion-frames.json"),
      JSON.stringify({ layout, gaps, frames }, null, 2),
    );
  } finally {
    await desktop.close();
    await rm(directory, { recursive: true, force: true });
  }
});
