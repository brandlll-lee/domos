import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { openGateway } from "../src/harness/gateway.mjs";
import { productCatalog } from "../src/harness/product-tools.ts";
import type { EngineRuntime } from "../src/harness/task-types.ts";

const { driver, theme } = vi.hoisted(() => ({
  theme: vi.fn(async () => {}),
  driver: {
    callTool: vi.fn(),
    listTools: vi.fn(async () => ({ tools: [] })),
  },
}));
vi.mock("../src/harness/desktop-driver.mjs", () => ({
  openDesktopDriver: async () => ({
    driver,
    client: driver,
    theme,
    close: vi.fn(),
  }),
}));
const entry = "../src/harness/computer-service.mjs";
const { openComputerService } = await import(entry);
function callDesktop(
  service: ReturnType<typeof openComputerService>,
  name: string,
  args: Record<string, unknown>,
  signal = new AbortController().signal,
) {
  return service.request(
    {
      operation: "call",
      service: "desktop",
      name,
      arguments: args,
    },
    signal,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

test("MCP validates native action output and preserves content", async () => {
  driver.callTool.mockResolvedValue({
    structuredContent: { effect: "confirmed", route: "background" },
    content: [],
    isError: false,
  });
  const service = openComputerService(".", ".");
  const tools = [
    {
      name: "click",
      description: "Click",
      inputSchema: { type: "object" },
      annotations: { readOnlyHint: false, idempotentHint: false },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { effect: { type: "string" }, route: { type: "string" } },
        required: ["effect", "route"],
      },
    },
  ];
  const catalog = await productCatalog(
    {
      agent: async () => ({ callable: tools }),
      registry: { tools: () => [] },
      snapshot: async () => ({
        tools: [...tools, { ...tools[0], name: "other_bot" }],
      }),
    } as unknown as EngineRuntime,
    BACKGROUND_CONTEXT,
  );
  expect(catalog.filter((tool) => tool.name === "click")).toEqual(tools);
  expect(catalog.some((tool) => tool.name === "other_bot")).toBe(false);
  const gateway = await openGateway(catalog, async (_id, name, args, signal) =>
    callDesktop(service, name, args, signal),
  );
  const client = new Client({ name: "test", version: "1" });
  onTestFinished(async () => {
    await client.close();
    await gateway.close();
    await service.close();
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(gateway.url)));
  await client.listTools();
  expect((await client.listTools()).tools[0]).toEqual(tools[0]);
  const result = await client.callTool({
    name: "click",
    arguments: { pid: 7, window_id: 90 },
  });
  expect(result.structuredContent).toEqual({
    effect: "confirmed",
    route: "background",
  });
  expect(result.content).toEqual([
    { type: "text", text: JSON.stringify(result.structuredContent) },
  ]);
});

test("the desktop relay preserves the native MCP envelope", async () => {
  const native = {
    content: [{ type: "text", text: "native" }],
    _meta: { receipt: "native" },
    structuredContent: { effect: "confirmed" },
  };
  driver.callTool.mockResolvedValue(native);
  const service = openComputerService(".", ".");
  const result = await callDesktop(service, "click", { pid: 7, window_id: 90 });
  expect(result._meta).toMatchObject(native._meta);
  expect(result.structuredContent).toEqual(native.structuredContent);
  expect(result.content).toEqual(expect.arrayContaining(native.content));
  await service.close();
});

test("cursor appearance follows Bot color and native sessions without changing action arguments", async () => {
  driver.callTool.mockResolvedValue({ content: [], isError: false });
  const service = openComputerService(".", ".");
  const signal = new AbortController().signal;
  const request = async (color: string, name = "click", args = {}) =>
    service.request(
      {
        operation: "call",
        service: "desktop",
        name,
        arguments: args,
        cursorColor: color,
      },
      signal,
    );
  await request("#4dd9cc");
  await request("#4dd9cc");
  await request("#ff776b");
  await request("#4dd9cc", "click", { session: "agent" });
  expect(theme.mock.calls).toEqual([
    ["#4dd9cc", "", signal],
    ["#ff776b", "", signal],
    ["#4dd9cc", "agent", signal],
  ]);
  await request("#4dd9cc", "end_session", { session: "agent" });
  await request("#4dd9cc", "start_session", { session: "agent" });
  await request("#4dd9cc", "click", { session: "agent" });
  expect(theme).toHaveBeenCalledTimes(4);
  expect(driver.callTool.mock.calls.at(-1)?.[0]).toEqual({
    name: "click",
    arguments: { session: "agent" },
  });
  theme.mockRejectedValueOnce(new Error("theme unavailable"));
  const notice = vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(request("#659fff")).resolves.toMatchObject({ isError: false });
  notice.mockRestore();
  await service.close();
});

test.each([
  [
    "get_window_state",
    { window_id: 90, since: "latest", include_screenshot: false },
  ],
  ["click", { session: "explicit", element_token: "s1:2" }],
  ["run_steps", { pid: 7, steps: [{ click: { x: 20, y: 30 } }] }],
  ["run_script", { code: "return 1" }],
  ["launch_app", { path: "player.exe" }],
  ["clipboard_write", { text: "song" }],
] as const)(
  "forwards %s exactly once with original arguments",
  async (name, args) => {
    const native = {
      content: [{ type: "image", mimeType: "image/png", data: "cGl4ZWw=" }],
      structuredContent: { code: "session_ended", observation: { ok: false } },
      isError: true,
    };
    driver.callTool.mockResolvedValue(native);
    const service = openComputerService(".", ".");
    const signal = new AbortController().signal;
    const input = structuredClone(args);
    for (let i = 0; i < 2; i++) {
      const result = await callDesktop(service, name, args, signal);
      expect(result).toMatchObject({
        ...native,
        content: expect.arrayContaining(native.content),
      });
    }
    expect(args).toEqual(input);
    expect(driver.callTool.mock.calls).toEqual([
      [{ name, arguments: args }, undefined, { signal }],
      [{ name, arguments: args }, undefined, { signal }],
    ]);
    await service.close();
  },
);

test("cancellation prevents native dispatch", async () => {
  const service = openComputerService(".", ".");
  const controller = new AbortController();
  controller.abort(new Error("stopped"));
  await expect(
    callDesktop(service, "click", {}, controller.signal),
  ).rejects.toThrow("stopped");
  expect(driver.callTool).not.toHaveBeenCalled();
  driver.callTool.mockResolvedValue({
    content: [],
    isError: false,
  });
  await expect(
    callDesktop(service, "click", { pid: 7 }),
  ).resolves.toMatchObject({ isError: false });
  expect(driver.callTool).toHaveBeenCalledOnce();
  await service.close();
});

test("cancellation during driver initialization prevents dispatch", async () => {
  const catalog = Promise.withResolvers<{ tools: never[] }>();
  driver.listTools.mockReturnValueOnce(catalog.promise);
  const service = openComputerService(".", ".");
  const controller = new AbortController();
  const request = callDesktop(service, "click", {}, controller.signal);
  controller.abort(new Error("stopped"));
  catalog.resolve({ tools: [] });
  await expect(request).rejects.toThrow("stopped");
  expect(driver.callTool).not.toHaveBeenCalled();
  await service.close();
});
