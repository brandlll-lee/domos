import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { release, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { runAssistant } from "../../../packages/agent/src/computer/assistant.ts";
import { assistInput } from "../../../packages/agent/src/computer/assistant-action.ts";
import { WorkProcess } from "../../../packages/agent/src/harness/process.ts";
import type { ProductResult } from "../../../packages/agent/src/harness/types.ts";
import { mountComputerEffectWithArt } from "../../../packages/ui/src/computer-effect.mjs";
import { effectArt } from "../../../packages/ui/src/computer-effect-art.mjs";

const electronEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && entry[0] !== "ELECTRON_RUN_AS_NODE",
  ),
);

test("foreground input keeps a restored window active and publishes its real outline", async ({
  playwright,
}) => {
  test.skip(
    process.platform !== "win32",
    "Native input needs an interactive desktop and OS permissions",
  );
  const application = await playwright._electron.launch({
    args: [resolve("apps/desktop/test/input-entry.mjs")],
    env: electronEnv,
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
        elements: Array<{
          label: string;
          element_token: string;
          frame: { x: number; y: number; w: number; h: number };
        }>;
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
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
    const pid = await application.evaluate(() => process.pid);
    const listed = await call("list_windows", { pid });
    const target = listed.structuredContent.windows.find(
      (item: { title: string }) => item.title === "Domos input target",
    );
    expect(target).toBeTruthy();
    if (!target) throw new Error("Target window required");
    const identity = { pid, window_id: target.window_id };
    expect((await call("end_session", {})).isError).toBe(false);
    const restored = await call("get_window_state", {
      ...identity,
      include_screenshot: false,
    });
    expect(restored.isError, JSON.stringify(restored.content)).toBe(false);
    expect(restored.structuredContent).toHaveProperty("snapshot_id");
    const fetcher = globalThis.fetch;
    try {
      globalThis.fetch = async (_url, init) => {
        const request = JSON.parse(String(init?.body));
        const criteria = request.questions.next.criteria as Record<
          string,
          string
        >;
        const choice =
          Object.keys(criteria).find((id) =>
            criteria[id]?.startsWith("Enter supplied"),
          ) ??
          Object.keys(criteria).find((id) =>
            criteria[id]?.startsWith("Click button Play"),
          ) ??
          "review";
        return Response.json({
          model: "fixture",
          answers: {
            next: {
              type: "choice",
              choice,
              confidence: 1,
              probabilities: { [choice]: 1 },
            },
          },
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      };
      const result = await runAssistant(
        assistInput.parse({
          service: "desktop",
          window: identity,
          goal: "Enter the song and play it",
          completion: "The output contains the song",
          inputs: [{ purpose: "song", text: "Jev native" }],
          steps: [
            { role: "Edit", label: "Song", action: "set_value", input: "song" },
            { role: "Button", label: "Play", action: "click" },
          ],
        }),
        { provider: "typesafe", key: "fixture" },
        async (name, args) => (await call(name, args)) as ProductResult,
        async () => true,
        AbortSignal.timeout(15000),
      );
      expect(
        result.structuredContent?.status,
        JSON.stringify(result.content),
      ).toBe("review");
      expect(result.structuredContent?.progress).toEqual(
        expect.arrayContaining([expect.objectContaining({ performed: 1 })]),
      );
      await expect(page.locator("output")).toHaveText("Jev native");
    } finally {
      globalThis.fetch = fetcher;
    }
    const observed = await call("get_window_state", {
      ...identity,
      max_elements: 250,
      tree_format: "elements",
      full_output: true,
    });
    expect(observed.isError, JSON.stringify(observed.content)).toBe(false);
    const field = await page.locator("input").boundingBox();
    expect(field).toBeTruthy();
    if (!field) throw new Error("Input bounds required");
    const button = observed.structuredContent.elements.find(
      (item) => item.label === "Play",
    );
    expect(button).toBeTruthy();
    if (!button) throw new Error("Button required");
    await page.locator("input").fill("Control input");
    await call("click", { ...identity, element_token: button.element_token });
    await expect(page.locator("output")).toHaveText("Control input");
    await call("get_window_state", { ...identity, include_screenshot: false });
    await expect
      .poll(async () => {
        const { frame } = await call("list_windows", {});
        return Math.hypot(
          (frame?.pointer?.x ?? 0) - (button.frame.x + button.frame.w / 2),
          (frame?.pointer?.y ?? 0) - (button.frame.y + button.frame.h / 2),
        );
      })
      .toBeLessThan(1);
    const control = await call("run_steps", {
      ...identity,
      steps: [
        {
          set_value: {
            role: "textfield",
            name: "Song",
            value: "Control input",
          },
        },
        {
          click: { role: "button", name: "Play" },
          expect: [{ text: "Control input" }],
        },
      ],
      observe: { include_screenshot: true },
    });
    expect(control.isError, JSON.stringify(control.content)).toBe(false);
    expect(control.structuredContent).toHaveProperty(
      "observation.state.snapshot_id",
    );
    expect(control.structuredContent).toMatchObject({
      observation: { state: identity },
    });
    expect(control.content).toContainEqual({
      type: "text",
      text: expect.stringContaining('"verification":"checked"'),
    });
    await expect(page.locator("output")).toHaveText("Control input");
    const incomplete = await call("run_steps", {
      pid,
      steps: [
        {
          set_value: { role: "textfield", name: "Song", value: "Wrong target" },
        },
      ],
      observe: {},
    });
    expect(incomplete.isError).toBe(true);
    await expect(page.locator("input")).toHaveValue("Control input");
    const checkpoint = await call("run_steps", {
      ...identity,
      steps: [
        {
          set_value: { role: "textfield", name: "Song", value: "Checkpoint" },
          expect: [{ text: "Editor ready", timeout_ms: 100 }],
        },
        { set_value: { role: "textfield", name: "Song", value: "Unreached" } },
      ],
      observe: { include_screenshot: true },
    });
    expect(checkpoint.isError).toBe(true);
    expect(checkpoint.structuredContent).toMatchObject({
      steps: [{ ok: false, phase: "expect" }],
      observation: { ok: true, state: identity },
    });
    await expect(page.locator("input")).toHaveValue("Checkpoint");
    const scale =
      observed.structuredContent.screenshot_width /
      (await page.evaluate(() => innerWidth));
    await application.evaluate(async ({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.minimize();
      const other = new BrowserWindow({ width: 900, height: 700 });
      await other.loadURL("data:text/html,<title>Domos other window</title>");
      other.focus();
    });
    await expect
      .poll(() => worker.activity?.window?.width !== target.bounds.width)
      .toBe(true);
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
      const captured = await call("get_window_state", {
        ...identity,
        include_accessibility_tree: false,
      });
      expect(captured.isError, JSON.stringify(captured.content)).toBe(false);
      if (name === "click") {
        const physical = await application.evaluate(
          ({ screen, BrowserWindow }, point) => {
            const window = BrowserWindow.getAllWindows().find(
              (item) => item.getTitle() === "Domos input target",
            );
            if (!window) throw new Error("Target window required");
            const origin = window.getContentBounds();
            return screen.dipToScreenPoint({
              x: origin.x + point.x,
              y: origin.y + point.y,
            });
          },
          { x: field.x + field.width / 2, y: field.y + field.height / 2 },
        );
        await expect
          .poll(async () => {
            const { frame } = await call("list_windows", {});
            return Math.hypot(
              (frame?.pointer?.x ?? 0) - physical.x,
              (frame?.pointer?.y ?? 0) - physical.y,
            );
          })
          .toBeLessThan(3);
      }
      await expect
        .poll(async () => (await call("list_windows", {})).frame)
        .toMatchObject({
          window: { width: target.bounds.width, height: target.bounds.height },
          covered: [],
        });
    }
    await expect(page.locator("output")).toHaveText("我这样爱你");
    const batch = await call("run_steps", {
      ...identity,
      delivery_mode: "foreground",
      steps: [
        {
          click: {
            x: (field.x + field.width / 2) * scale,
            y: (field.y + field.height / 2) * scale,
          },
        },
        { hotkey: { keys: ["ctrl", "a"] } },
        { type_text: { text: "Batch input" } },
        { press_key: { key: "tab" } },
        { press_key: { key: "return" } },
      ],
      observe: { include_screenshot: true },
    });
    expect(batch.isError, JSON.stringify(batch.content)).toBe(false);
    expect(batch.structuredContent).toHaveProperty(
      "observation.state.snapshot_id",
    );
    await expect(page.locator("output")).toHaveText("Batch input");
    const positions = new Set<number>();
    const moved = () => {
      if (worker.activity?.pointer) positions.add(worker.activity.pointer.x);
    };
    worker.events.on("activity", moved);
    await call("run_steps", {
      steps: [100, 350, 600].map((x) => ({ move_cursor: { x, y: 300 } })),
      delay_ms: 400,
    });
    worker.events.off("activity", moved);
    expect(positions.size).toBeGreaterThanOrEqual(2);
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
    content: `window.mountComputerEffect = (container) => (${mountComputerEffectWithArt.toString()})(container, ${JSON.stringify(effectArt)})`,
  });
  const result = await page.evaluate(async () => {
    const host = document.querySelector("#effect") as HTMLElement;
    const mount = (
      window as unknown as {
        mountComputerEffect: (
          container: HTMLElement,
        ) => ReturnType<typeof mountComputerEffectWithArt>;
      }
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
  const child = spawn(
    executable,
    [resolve("packages/agent/src/harness/desktop-overlay.mjs")],
    {
      env: electronEnv,
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
    if (process.platform === "win32") {
      for (;;) {
        const [value] = await once(child, "message", { signal });
        if (value.type === "windows") {
          expect(Array.isArray(value.ids)).toBe(true);
          break;
        }
      }
    }
    const captured = (async () => {
      for (;;) {
        const [value] = await once(child, "message", { signal });
        if (value.type === "capture" && value.id === 1) return value;
      }
    })();
    child.send({ type: "capture", id: 1, hidden: true });
    expect(await captured).toEqual({ type: "capture", id: 1 });
    child.send({ type: "capture", hidden: false });
    const ended = once(child, "exit", { signal });
    child.disconnect();
    expect(await ended).toEqual([0, null]);
  } finally {
    if (child.connected) child.disconnect();
    if (child.exitCode === null) child.kill();
  }
});

test("desktop effects follow displays, protect captures, reuse native windows and expire after disconnect", async ({
  playwright,
}, testInfo) => {
  const application = await playwright._electron.launch({
    args: [resolve("apps/desktop/test/effect-entry.mjs")],
    env: electronEnv,
  });
  const send = (value: unknown) =>
    application.evaluate((_electron, value) => {
      (process as NodeJS.EventEmitter).emit("computer-effect-input", value);
    }, value);
  const visible = (value: boolean) =>
    application.evaluate(
      ({ BrowserWindow }, value) =>
        BrowserWindow.getAllWindows().every(
          (window) => window.isVisible() === value,
        ),
      value,
    );
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
      (80 * geometry.dip.height) / geometry.physical.height - 5,
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
    await expect(page.locator(".rim .cut")).toHaveCSS(
      "mask-image",
      /data:image\/svg/,
    );
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
    const captureExcluded =
      process.platform === "win32" && Number(release().split(".")[2]) >= 19041;
    await application.evaluate(({ BrowserWindow }) => {
      const calls = { bounds: 0, show: 0, hide: 0 };
      for (const window of BrowserWindow.getAllWindows()) {
        const bounds = window.setBounds.bind(window);
        const show = window.showInactive.bind(window);
        window.setBounds = (...args) => {
          calls.bounds++;
          bounds(...args);
        };
        window.showInactive = () => {
          calls.show++;
          show();
        };
        window.on("hide", () => calls.hide++);
      }
      (process as NodeJS.EventEmitter).once("computer-effect-calls", (reply) =>
        reply(calls),
      );
    });
    for (let id = 1; id <= 12; id++) {
      await send({ type: "capture", id, hidden: true });
      expect(await visible(captureExcluded)).toBe(true);
      await send({ type: "capture", hidden: false });
      await send({ ...state, color: "#80b780", expiresAt: Date.now() + 10000 });
      await expect(rim).toBeVisible();
      await expect(page.locator(".cursor")).toBeVisible();
    }
    const calls = await application.evaluate(
      () =>
        new Promise((reply) =>
          (process as NodeJS.EventEmitter).emit("computer-effect-calls", reply),
        ),
    );
    expect(calls).toEqual({
      bounds: 0,
      show: captureExcluded ? 0 : 12 * geometry.count,
      hide: captureExcluded ? 0 : 12 * geometry.count,
    });
    if (captureExcluded) {
      const entry = new URL(
        "../../../packages/agent/node_modules/@trycua/cua-driver/dist/index.js",
        import.meta.url,
      );
      const { CuaDriver } = await import(entry.href);
      const driver = CuaDriver.create();
      try {
        const capture = async () => {
          const result = await driver.callTool("get_desktop_state", "{}");
          expect(result.isError).toBe(false);
          return application.evaluate(({ nativeImage }, image) => {
            const captured = nativeImage.createFromBuffer(
              Buffer.from(image, "base64"),
            );
            return [
              ...captured
                .crop({ x: 250, y: 250, width: 1, height: 1 })
                .toBitmap(),
            ];
          }, result.images[0].dataBase64);
        };
        await send(null);
        const baseline = await capture();
        await page.evaluate(() => {
          const marker = document.createElement("div");
          marker.style.cssText =
            "position:fixed;left:0;top:0;width:100%;height:100%;background:#ff00ff;z-index:999";
          document.body.append(marker);
        });
        await send({ ...state, expiresAt: Date.now() + 10000 });
        await expect(rim).toBeVisible();
        expect(await capture()).toEqual(baseline);
        await application.evaluate(({ BrowserWindow }) => {
          for (const window of BrowserWindow.getAllWindows())
            window.setContentProtection(false);
        });
        await page.screenshot();
        const control = await capture();
        expect(control).not.toEqual(baseline);
        expect(control[0]).toBeGreaterThan((control[1] ?? 255) + 50);
        expect(control[2]).toBeGreaterThan((control[1] ?? 255) + 50);
        await application.evaluate(({ BrowserWindow }) => {
          for (const window of BrowserWindow.getAllWindows())
            window.setContentProtection(true);
        });
        await page.screenshot();
        expect(await capture()).toEqual(baseline);
        expect(await visible(true)).toBe(true);
      } finally {
        await driver.shutdown();
        driver.uniffiDestroy();
      }
    }
    await send(null);
    await expect.poll(() => visible(false)).toBe(true);
    await send({ ...state, expiresAt: Date.now() + 10000 });
    await expect(rim).toBeVisible();
    await expect.poll(() => visible(false), { timeout: 5000 }).toBe(true);
  } finally {
    await application.close();
  }
});
