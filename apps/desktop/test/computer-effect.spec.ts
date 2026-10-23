import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("desktop effects follow displays, pass input through, hide for captures and expire after disconnect", async ({
  playwright,
}, testInfo) => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const application = await playwright._electron.launch({
    args: [resolve("apps/desktop/test/effect-entry.mjs")],
    env,
  });
  const send = (value: unknown) =>
    application.evaluate((_electron, value) => {
      (process as NodeJS.EventEmitter).emit("computer-effect-input", value);
    }, value);
  try {
    const geometry = await application.evaluate(({ screen }) => {
      const display = screen.getPrimaryDisplay();
      return {
        physical:
          process.platform === "win32"
            ? screen.dipToScreenRect(null, display.bounds)
            : display.bounds,
        dip: display.bounds,
        count: screen.getAllDisplays().length,
      };
    });
    const state = {
      botId: 1,
      color: "#c4789b",
      screen: geometry.physical,
      window: { ...geometry.physical, width: geometry.physical.width / 2 },
      covered: [],
      expiresAt: Date.now() + 10000,
      pointer: {
        x: geometry.physical.x + 80,
        y: geometry.physical.y + 80,
        action: "click",
        id: 1,
        expiresAt: Date.now() + 10000,
      },
    };
    await send(state);
    const page = await application.firstWindow();
    const rim = page.locator(".rim");
    await expect(rim).toBeVisible();
    const actual = await rim.boundingBox();
    expect(actual?.width).toBeCloseTo(geometry.dip.width / 2, 0);
    await page.screenshot({
      path: testInfo.outputPath("computer-effect.png"),
      omitBackground: true,
    });
    const options = await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => ({
        focusable: window.isFocusable(),
        top: window.isAlwaysOnTop(),
        focused: window.isFocused(),
      })),
    );
    expect(options).toHaveLength(geometry.count);
    expect(
      options.every((item) => !item.focusable && !item.focused && item.top),
    ).toBe(true);
    await send({ ...state, color: "#80b780" });
    await expect
      .poll(() =>
        page
          .locator("domos-computer-effect")
          .evaluate((element) =>
            (element as HTMLElement).style.getPropertyValue("--bot-color"),
          ),
      )
      .toBe("#80b780");
    await send({ type: "capture", id: 1, hidden: true });
    await expect
      .poll(() =>
        application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().every((window) => !window.isVisible()),
        ),
      )
      .toBe(true);
    await send({ type: "capture", hidden: false });
    await expect
      .poll(() =>
        application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().some((window) => window.isVisible()),
        ),
      )
      .toBe(true);
    await send(null);
    await expect
      .poll(() =>
        application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().every((window) => !window.isVisible()),
        ),
      )
      .toBe(true);
    await send({ ...state, expiresAt: Date.now() + 10000 });
    await expect(rim).toBeVisible();
    await expect
      .poll(
        () =>
          application.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().every(
              (window) => !window.isVisible(),
            ),
          ),
        { timeout: 5000 },
      )
      .toBe(true);
  } finally {
    await application.close();
  }
});
