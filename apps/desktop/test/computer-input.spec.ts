import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { runAssistant } from "../../../packages/agent/src/computer/assistant.ts";
import { assistInput } from "../../../packages/agent/src/computer/assistant-action.ts";
import { openGateway } from "../../../packages/agent/src/harness/gateway.mjs";
import { WorkProcess } from "../../../packages/agent/src/harness/process.ts";
import type {
  ProductResult,
  ProductTool,
} from "../../../packages/agent/src/harness/types.ts";

const electronEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && entry[0] !== "ELECTRON_RUN_AS_NODE",
  ),
);

test("native desktop input, cursor and conditions use the driver session", async ({
  playwright,
}) => {
  test.skip(
    process.platform !== "win32",
    "Native input needs an interactive desktop and OS permissions",
  );
  const application = await playwright._electron.launch({
    args: [fileURLToPath(new URL("./input-entry.mjs", import.meta.url))],
    env: electronEnv,
  });
  const directory = await mkdtemp(join(tmpdir(), "domos-input-"));
  const executable = createRequire(new URL("../package.json", import.meta.url))(
    "electron",
  );
  const worker = new WorkProcess(
    [
      executable,
      fileURLToPath(
        new URL(
          "../../../packages/agent/src/harness/worker.mjs",
          import.meta.url,
        ),
      ),
    ],
    { cwd: directory, home: directory },
    [],
    async () => ({ content: [] }),
  );
  let cursorColor = "#4dd9cc";
  const call = async (name: string, args: Record<string, unknown>) => ({
    ...(await worker.computer<{
      isError: boolean;
      content: unknown[];
      structuredContent: {
        theme: { id: string };
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
        cursorColor,
      },
      AbortSignal.timeout(30000),
    )),
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
    const ended = await call("get_window_state", identity);
    expect(ended.isError).toBe(true);
    expect((await call("start_session", {})).isError).toBe(false);
    const restored = await call("get_window_state", {
      ...identity,
      include_screenshot: false,
    });
    expect(restored.isError, JSON.stringify(restored.content)).toBe(false);
    expect(restored.structuredContent).toHaveProperty("snapshot_id");
    const gateway = await openGateway(
      await worker.computer<ProductTool[]>({
        operation: "catalog",
        service: "desktop",
      }),
      async (_id, name, args, signal) =>
        worker.computer(
          { operation: "call", service: "desktop", name, arguments: args },
          signal,
        ),
    );
    const agentRequire = createRequire(
      new URL("../../../packages/agent/package.json", import.meta.url),
    );
    const { Client } = agentRequire(
      "@modelcontextprotocol/sdk/client/index.js",
    );
    const { StreamableHTTPClientTransport } = agentRequire(
      "@modelcontextprotocol/sdk/client/streamableHttp.js",
    );
    const client = new Client({ name: "native-schema", version: "1" });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(gateway.url)),
      );
      await client.listTools();
      expect(
        (
          await client.callTool({
            name: "get_window_state",
            arguments: identity,
          })
        ).isError,
      ).not.toBe(true);
      const apps = await client.callTool({ name: "list_apps", arguments: {} });
      expect(apps.isError).not.toBe(true);
      const catalog = apps.structuredContent as { apps: unknown[] };
      expect(Array.isArray(catalog.apps)).toBe(true);
      const counted = await client.callTool({
        name: "query_result",
        arguments: { result: "r2", query: "length(apps)" },
      });
      expect(counted.isError).not.toBe(true);
      expect(
        JSON.parse((counted.content as { text: string }[])[0]?.text ?? ""),
      ).toBe(catalog.apps.length);
    } finally {
      await client.close();
      await gateway.close();
    }
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
    expect(await call("get_agent_cursor_state", {})).toMatchObject({
      structuredContent: {
        enabled: true,
        theme: { id: "app.domos.cursor.c4dd9cc" },
        motion: { style: "signature_arc", timing: "steady" },
        visual_state: { requested_action: "click" },
      },
    });
    await call("get_window_state", { ...identity, include_screenshot: false });
    const control = await call("run_steps", {
      ...identity,
      observe: {},
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
    });
    expect(control.isError, JSON.stringify(control.content)).toBe(false);
    expect(control.structuredContent).toHaveProperty(
      "observation.state.snapshot_id",
    );
    expect(control.structuredContent).toMatchObject({
      observation: { state: identity },
    });
    expect(control.structuredContent).toMatchObject({
      steps: [{ ok: true }, { ok: true }],
    });
    await expect(page.locator("output")).toHaveText("Control input");
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
    await call("get_window_state", { ...identity, include_screenshot: false });
    const scale =
      observed.structuredContent.screenshot_width /
      (await page.evaluate(() => innerWidth));
    await application.evaluate(async ({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.minimize();
      const other = new BrowserWindow({ width: 900, height: 700 });
      await other.loadURL("data:text/html,<title>Domos other window</title>");
      other.focus();
    });
    await call("list_windows", {});
    await call("bring_to_front", identity);
    await call("get_window_state", identity);
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
    }
    await expect(page.locator("output")).toHaveText("我这样爱你");
    expect(await call("get_agent_cursor_state", {})).toMatchObject({
      structuredContent: {
        enabled: true,
        position: { x: expect.any(Number), y: expect.any(Number) },
        session: expect.any(String),
      },
    });
    cursorColor = "#ff776b";
    await expect
      .poll(() => call("get_agent_cursor_state", {}))
      .toMatchObject({
        structuredContent: { theme: { id: "app.domos.cursor.cff776b" } },
      });
    await expect
      .poll(() => call("get_agent_cursor_state", { session: "color-check" }))
      .toMatchObject({
        structuredContent: { theme: { id: "app.domos.cursor.cff776b" } },
      });
    await call("end_session", { session: "color-check" });
    const batch = await call("run_steps", {
      ...identity,
      delivery_mode: "foreground",
      observe: { include_screenshot: true },
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
    });
    expect(batch.isError, JSON.stringify(batch.content)).toBe(false);
    expect(batch.structuredContent).toHaveProperty(
      "observation.state.snapshot_id",
    );
    expect(
      batch.content.some((item) => (item as { type: string }).type === "image"),
    ).toBe(true);
    await expect(page.locator("output")).toHaveText("Batch input");
    await call("get_window_state", { ...identity, include_screenshot: false });
    const script = await call("run_script", {
      script: `const app = await cua.getApp(${JSON.stringify({ pid, windowId: target.window_id })}); await app.setValue({role:"textfield",name:"Song"}, "Script input"); await app.click({role:"button",name:"Play"}); return "done";`,
    });
    expect(script.isError, JSON.stringify(script.content)).toBe(false);
    await expect(page.locator("output")).toHaveText("Script input");
    const next = await call("run_script", { script: 'return "done";' });
    expect(next.isError, JSON.stringify(next.content)).toBe(false);
  } finally {
    await worker.close();
    await application.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});
