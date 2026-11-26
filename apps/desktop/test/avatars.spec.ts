import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

test("startup shows the approved companions in both themes and a narrow window", async ({
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
    const styleErrors: string[] = [];
    page.on("console", (message) => {
      if (
        message
          .text()
          .includes("violates the following Content Security Policy")
      )
        styleErrors.push(message.text());
    });
    await page.reload();
    await expect(page.locator(".startup-characters .character")).toHaveCount(5);
    await page.evaluate(() => document.fonts.ready);
    expect(styleErrors).toEqual([]);
    for (const colorScheme of ["dark", "light"] as const) {
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
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate(() =>
      localStorage.setItem("domos:appearance:v1", "dark"),
    );
    await page.reload();
    await expect(page.locator(".startup-pages")).toHaveCSS(
      "background-color",
      "rgb(15, 15, 16)",
    );
    const remote = page.getByRole("button", {
      name: "连接另一台电脑",
      exact: true,
    });
    await remote.scrollIntoViewIfNeeded();
    await expect(remote).toBeInViewport();
  } finally {
    await desktop.close();
    await rm(directory, { recursive: true, force: true });
  }
});
