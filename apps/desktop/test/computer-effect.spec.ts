import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { WorkProcess } from "../../../packages/agent/src/harness/process.ts";
import { mountComputerEffect } from "../../../packages/ui/src/computer-effect.mjs";

test("foreground input keeps a restored window active and publishes its real outline", async ({
  playwright,
}) => {
  test.skip(
    process.platform !== "win32",
    "Native input needs an interactive desktop and OS permissions",
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const application = await playwright._electron.launch({
    args: [resolve("apps/desktop/test/input-entry.mjs")],
    env,
  });
  const directory = await mkdtemp(join(tmpdir(), "domos-input-"));
  const executable = createRequire(new URL("../package.json", import.meta.url))(
    "electron",
  );
  const worker = new WorkProcess(
    [executable, resolve("packages/agent/src/harness/worker.mjs")],
    { cwd: directory, home: directory },
    [],
    async () => ({ content: [] }),
  );
  const call = async (name: string, args: Record<string, unknown>) => ({
    ...(await worker.computer<{
      isError: boolean;
      content: unknown[];
      structuredContent: {
        windows: Array<{
          title: string;
          window_id: number;
          bounds: { width: number; height: number };
        }>;
        screenshot_width: number;
      };
    }>(
      {
        operation: "call",
        service: "desktop",
        name,
        arguments: args,
        actor: { botId: 1, color: "#68b6ff", owner: "test" },
      },
      AbortSignal.timeout(30000),
    )),
    frame: worker.activity,
  });
  try {
    const page = await application.firstWindow();
    const pid = await application.evaluate(() => process.pid);
    const listed = await call("list_windows", { pid });
    const target = listed.structuredContent.windows.find(
      (item: { title: string }) => item.title === "Domos input target",
    );
    expect(target).toBeTruthy();
    if (!target) throw new Error("Target window required");
    const identity = { pid, window_id: target.window_id };
    const observed = await call("get_window_state", {
      ...identity,
      max_elements: 20,
      tree_format: "elements",
    });
    expect(observed.isError, JSON.stringify(observed.content)).toBe(false);
    const field = await page.locator("input").boundingBox();
    expect(field).toBeTruthy();
    if (!field) throw new Error("Input bounds required");
    const scale =
      observed.structuredContent.screenshot_width /
      (await page.evaluate(() => innerWidth));
    await application.evaluate(async ({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.minimize();
      const other = new BrowserWindow({ width: 900, height: 700 });
      await other.loadURL("data:text/html,<title>Domos other window</title>");
      other.focus();
    });
    for (const [name, args] of [
      [
        "click",
        {
          x: (field.x + field.width / 2) * scale,
          y: (field.y + field.height / 2) * scale,
        },
      ],
      ["hotkey", { keys: ["ctrl", "a"] }],
      ["type_text", { text: "我这样爱你" }],
      ["press_key", { key: "tab" }],
      ["press_key", { key: "return" }],
    ] as const) {
      const result = await call(name, {
        ...identity,
        ...args,
        delivery_mode: "foreground",
      });
      expect(result.isError, JSON.stringify(result.content)).toBe(false);
      if (name === "type_text")
        await expect(page.locator("input")).toHaveValue("我这样爱你");
      expect(
        await application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getFocusedWindow()?.getTitle(),
        ),
      ).toBe("Domos input target");
      await expect
        .poll(async () => (await call("list_windows", {})).frame)
        .toMatchObject({
          window: { width: target.bounds.width, height: target.bounds.height },
          covered: [],
        });
    }
    await expect(page.locator("output")).toHaveText("我这样爱你");
    await worker.computer({ operation: "activity", owner: "test" });
    expect(worker.activity).toBeNull();
  } finally {
    await worker.close();
    await application.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("heartbeats keep one click and cursor motion continues from its visible position", async ({
  browser,
}) => {
  const page = await browser.newPage();
  await page.setContent(
    '<div id="effect" style="position:relative;width:1000px;height:700px"></div>',
  );
  await page.addScriptTag({
    content: `window.mountComputerEffect = ${mountComputerEffect.toString()}`,
  });
  const result = await page.evaluate(async () => {
    const host = document.querySelector("#effect") as HTMLElement;
    const mount = (
      window as unknown as { mountComputerEffect: typeof mountComputerEffect }
    ).mountComputerEffect;
    const effect = mount(host);
    const cursor = host.shadowRoot?.querySelector(".cursor") as HTMLElement;
    let clicks = 0;
    cursor.addEventListener("animationstart", () => clicks++);
    const frame = (id: number, x: number) => ({
      color: "#68b6ff",
      screen: { x: 0, y: 0, width: 1000, height: 700 },
      window: { x: 20, y: 20, width: 950, height: 650 },
      covered: [],
      pointer: {
        id,
        x,
        y: 200,
        action: "click" as const,
        expiresAt: Date.now() + 10000,
        motion: [
          { t: 0, x: 100, y: 200 },
          { t: 0.2, x: 500, y: 160 },
          { t: 0.4, x, y: 200 },
        ],
      },
      expiresAt: Date.now() + 10000,
    });
    const wait = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    effect.update(frame(1, 100));
    await wait(450);
    const before = clicks;
    for (let i = 0; i < 4; i++) {
      effect.update(frame(1, 100));
      await wait(100);
    }
    const repeated = clicks - before;
    effect.update(frame(2, 900));
    await wait(100);
    const middle = new DOMMatrix(getComputedStyle(cursor).transform);
    effect.update(frame(3, 300));
    const resumed = new DOMMatrix(getComputedStyle(cursor).transform);
    effect.close();
    return {
      repeated,
      x: middle.m41,
      y: middle.m42,
      jump: Math.abs(resumed.m41 - middle.m41),
    };
  });
  expect(result.repeated).toBe(0);
  expect(result.x).toBeGreaterThan(95);
  expect(result.x).toBeLessThan(895);
  expect(result.y).toBeLessThan(197);
  expect(result.jump).toBeLessThan(20);
  await page.close();
});

test("the production overlay receives frames over IPC and closes with its parent", async () => {
  const executable = createRequire(new URL("../package.json", import.meta.url))(
    "electron",
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    executable,
    [resolve("packages/agent/src/harness/desktop-overlay.mjs")],
    {
      env,
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  const signal = AbortSignal.timeout(10000);
  try {
    const [screen] = await once(child, "message", { signal });
    expect(screen.type).toBe("screen");
    child.send({
      botId: 1,
      color: "#68b6ff",
      screen: screen.bounds,
      window: { x: 80, y: 80, width: 640, height: 480 },
      covered: [],
      pointer: null,
      expiresAt: Date.now() + 10000,
    });
    const captured = once(child, "message", { signal });
    child.send({ type: "capture", id: 1, hidden: true });
    expect(await captured).toEqual([{ type: "capture", id: 1 }]);
    child.send({ type: "capture", hidden: false });
    const ended = once(child, "exit", { signal });
    child.disconnect();
    expect(await ended).toEqual([0, null]);
  } finally {
    if (child.connected) child.disconnect();
    if (child.exitCode === null) child.kill();
  }
});

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
            : process.platform === "linux"
              ? {
                  ...screen.dipToScreenPoint({
                    x: display.bounds.x,
                    y: display.bounds.y,
                  }),
                  width: display.bounds.width * display.scaleFactor,
                  height: display.bounds.height * display.scaleFactor,
                }
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
    expect(actual?.x).toBeCloseTo(0, 0);
    expect(actual?.y).toBeCloseTo(0, 0);
    expect(actual?.width).toBeCloseTo(geometry.dip.width / 2, 0);
    expect(actual?.height).toBeCloseTo(geometry.dip.height, 0);
    const cursor = await page.locator(".cursor").boundingBox();
    expect(cursor?.x).toBeCloseTo(
      (80 * geometry.dip.width) / geometry.physical.width - 5,
      0,
    );
    expect(cursor?.y).toBeCloseTo(
      (80 * geometry.dip.height) / geometry.physical.height - 3,
      0,
    );
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
    await send({
      ...state,
      covered: [
        {
          ...geometry.physical,
          width: 100,
          height: geometry.physical.height / 2,
        },
      ],
    });
    await expect(rim).toHaveCSS("mask-image", /data:image\/svg/);
    const image = await page.screenshot({ omitBackground: true });
    const alpha = await application.evaluate(
      ({ nativeImage }, image) => {
        const captured = nativeImage.createFromBuffer(Buffer.from(image));
        const { width, height } = captured.getSize();
        const bitmap = captured.toBitmap();
        return [Math.floor(height / 4), Math.floor((height * 3) / 4)].map(
          (y) => bitmap[(y * width + 1) * 4 + 3],
        );
      },
      [...image],
    );
    expect(alpha[0]).toBe(0);
    expect(alpha[1]).toBeGreaterThan(100);
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
