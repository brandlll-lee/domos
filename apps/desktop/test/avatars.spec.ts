import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

test("startup Bot follows the pointer and changes shape while working", async ({
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
    const viewport = page.locator(".startup-guide");
    await expect(viewport).toHaveCSS("scrollbar-width", "none");
    const advanced = page.getByRole("button", { name: "高级", exact: true });
    const corner = await advanced.boundingBox();
    const windowSize = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    }));
    expect(corner?.x).toBeGreaterThan(windowSize.width * 0.8);
    expect(corner?.y).toBeGreaterThan(windowSize.height * 0.85);
    await advanced.click();
    const docker = page.getByRole("menuitem", {
      name: "在 Docker 中运行",
      exact: true,
    });
    await expect(docker).toBeVisible();
    expect((await docker.boundingBox())?.y).toBeLessThan(corner?.y ?? 0);
    await docker.click();
    await expect(page.getByRole("menu")).toBeHidden();
    await expect(advanced).toContainText("Docker");
    await advanced.click();
    await page.getByRole("menuitem", { name: "直接运行", exact: true }).click();
    await advanced.focus();
    await page.keyboard.press("ArrowUp");
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(advanced).toBeFocused();
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(1120, 640),
    );
    await expect.poll(() => page.evaluate(() => innerHeight)).toBeLessThan(650);
    await expect
      .poll(() =>
        viewport.evaluate((node) => node.scrollHeight <= node.clientHeight + 1),
      )
      .toBe(true);
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(1120, 820),
    );
    await expect
      .poll(() => page.evaluate(() => innerHeight))
      .toBeGreaterThan(700);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const hero = page.getByRole("button", { name: "随机变身", exact: true });
    const working = hero.locator("[data-work=working]");
    const gesture = hero.locator(".character-gesture");
    await expect(working).toBeVisible();
    const shape = await working.getAttribute("data-shape");
    await hero.focus();
    await page.keyboard.press("Enter");
    await expect(working).not.toHaveAttribute("data-shape", shape ?? "");
    await expect(hero).toBeFocused();
    await expect(gesture).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const gaze = () =>
      hero.evaluate((node) =>
        Number.parseFloat(node.style.getPropertyValue("--character-gaze-x")),
      );
    const follow = (direction: number) =>
      hero.evaluate((button, direction) => {
        const { left, top, width, height } = button.getBoundingClientRect();
        window.dispatchEvent(
          new PointerEvent("pointermove", {
            pointerType: "mouse",
            clientX: Math.max(1, left + width / 2 + 200 * direction),
            clientY: top + height / 2,
          }),
        );
      }, direction);
    await hero.hover();
    await follow(-1);
    await expect.poll(gaze).toBeLessThan(-0.3);
    await follow(1);
    await expect.poll(gaze).toBeGreaterThan(0.3);
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
    await page
      .getByRole("button", { name: "连接另一台电脑", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", { name: "连接另一台电脑", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await page.screenshot({
      path: testInfo.outputPath("welcome-narrow.png"),
      scale: "css",
    });
  } finally {
    await desktop.close();
    await rm(directory, { recursive: true, force: true });
  }
});
