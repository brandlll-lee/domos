import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { expect, test, vi } from "vitest";
import type { Computers } from "../src/computer/catalog.ts";
import { ComputerServices } from "../src/computer/services.ts";
import { ComputerTools } from "../src/computer/tools.ts";
import type { Files } from "../src/files.ts";
import { computerEvidence } from "../src/harness/evidence.ts";
import type { WorkProcess } from "../src/harness/process.ts";

const signal = () => new AbortController().signal;
test.each([
  "browser_agent_browser_click",
  "browser_agent_browser_eval",
  "desktop_run_steps",
])("%s requires shared approval", async (name) => {
  const services = {
    catalog: async (_id: number, service: string) => [
      { name: name.slice(service.length + 1), inputSchema: {} },
    ],
    call: vi.fn(async () => ({ content: [] })),
  };
  const tools = new ComputerTools({
    transfer: async (_id: number, work: () => unknown) => work(),
    serviceTarget: async () => ({
      id: "pc",
      target: { services },
      enabled: {
        browser: name.startsWith("browser"),
        desktop: name.startsWith("desktop"),
      },
    }),
    assistance: { state: async () => ({ enabled: false }) },
    color: async () => "blue",
  } as unknown as Computers);
  const deny = vi.fn(async () => false);
  expect(
    await tools.invoke(1, name, {}, "task", signal(), context, deny),
  ).toMatchObject({ isError: true });
  expect(deny).toHaveBeenCalledTimes(1);
  expect(services.call).not.toHaveBeenCalled();
  expect(
    await tools.invoke(1, name, {}, "task", signal(), context),
  ).toMatchObject({ isError: true });
  await tools.invoke(1, name, {}, "task", signal(), context, async () => true);
  expect(services.call).toHaveBeenCalledTimes(1);
});

test.each([true, false])(
  "sharedDesktop=%s binds control to the actual display",
  async (sharedDesktop) => {
    const request = vi.fn(async () => ({
      available: true,
      error: null,
      sharedDesktop,
    }));
    const services = new ComputerServices(
      async () =>
        ({
          computer: request,
          closed: new Promise(() => {}),
        }) as unknown as WorkProcess,
    );
    await services.prepare(1, "browser", context);
    const browser = await services.takeover(1, "browser");
    const action = () =>
      services.run(2, "desktop", "task", signal(), async () => "delivered");
    if (sharedDesktop) await expect(action()).rejects.toThrow("接管");
    else expect(await action()).toBe("delivered");
    await services.release(1, "browser", browser);
    const desktop = await services.takeover(2, "desktop");
    const browserAction = () =>
      services.run(1, "browser", "task", signal(), async () => "delivered");
    if (sharedDesktop) await expect(browserAction()).rejects.toThrow("接管");
    else expect(await browserAction()).toBe("delivered");
    await services.release(2, "desktop", desktop);
  },
);

test("unknown browser work blocks desktop actions and takeover without stranding a lease", async () => {
  let unknown = false;
  const services = new ComputerServices(
    async () =>
      ({
        closed: new Promise(() => {}),
        computer: async (input: { operation: string }) => {
          if (input.operation === "settle" && unknown)
            throw new Error("浏览器操作结果未知");
          return { available: true, error: null, sharedDesktop: true };
        },
      }) as unknown as WorkProcess,
  );
  await services.prepare(1, "browser", context);
  unknown = true;
  await expect(services.takeover(1, "browser")).rejects.toThrow("结果未知");
  services.viewAccess(1, "browser");
  await expect(
    services.run(2, "desktop", "task", signal(), async () => {}),
  ).rejects.toThrow("结果未知");
  unknown = false;
  const lease = await services.takeover(1, "browser");
  await services.release(1, "browser", lease);
});

test("evidence storage failure preserves native action results", async () => {
  const result = {
    content: [{ type: "image" as const, data: "eA==", mimeType: "image/png" }],
    isError: false,
    structuredContent: { native: "delivered" },
  };
  const files = {
    capture: vi.fn(async () => {
      throw new Error("Storage unavailable");
    }),
  } as unknown as Files;
  const delivered = await computerEvidence(
    files,
    1,
    "task",
    "call",
    "browser",
    result,
    context,
  );
  expect(delivered).toMatchObject({
    isError: false,
    structuredContent: { native: "delivered" },
  });
  expect(delivered.content[0]).toEqual(result.content[0]);
  expect(JSON.stringify(delivered.content)).toContain(
    "do not repeat the action",
  );
});

test("strict native output keeps evidence in supported text content", async () => {
  const result = {
    content: [{ type: "image" as const, data: "eA==", mimeType: "image/png" }],
    structuredContent: { native: "delivered" },
  };
  const files = {
    capture: vi.fn(async () => ({ id: "evidence" })),
  } as unknown as Files;
  const delivered = await computerEvidence(
    files,
    1,
    "task",
    "call",
    "browser",
    result,
    context,
    { type: "object", additionalProperties: false },
  );
  expect(delivered.structuredContent).toEqual(result.structuredContent);
  expect(JSON.stringify(delivered.content)).toContain("evidence");
});

test("closing a stale viewer does not create a new worker", async () => {
  const open = vi.fn(async () => {
    throw new Error("Unexpected worker");
  });
  const services = new ComputerServices(open);
  await services.viewer(
    1,
    { operation: "view", service: "browser", id: "old", action: "close" },
    signal(),
    context,
  );
  await expect(
    services.viewer(
      1,
      { operation: "view", service: "browser", id: "old", action: "next" },
      signal(),
      context,
    ),
  ).rejects.toThrow("画面连接");
  expect(open).not.toHaveBeenCalled();
});

test("returning control waits for dispatched human input", async () => {
  const started = Promise.withResolvers<void>();
  const done = Promise.withResolvers<object>();
  const services = new ComputerServices(
    async () =>
      ({
        closed: new Promise(() => {}),
        computer: async (request: { operation: string; action?: string }) => {
          if (request.operation === "view" && request.action === "send") {
            started.resolve();
            return done.promise;
          }
          return { available: true, error: null, sharedDesktop: true };
        },
      }) as unknown as WorkProcess,
  );
  await services.prepare(1, "browser", context);
  const lease = await services.takeover(1, "browser");
  const input = services.viewer(
    1,
    {
      operation: "view",
      service: "browser",
      id: "view",
      action: "send",
      message: { type: "text", text: "Draft" },
    },
    signal(),
    context,
  );
  await started.promise;
  const returning = services.release(1, "browser", lease);
  await expect(
    services.run(1, "browser", "task", signal(), async () => {}),
  ).rejects.toThrow("接管");
  done.resolve({});
  await input;
  await returning;
  await services.run(1, "browser", "task", signal(), async () => {});
});

test("a stale concurrent release cannot clear a new takeover", async () => {
  const services = new ComputerServices(async () => {
    throw new Error("Unexpected worker");
  });
  const first = await services.takeover(1, "browser");
  const release = services.release(1, "browser", first);
  const stale = services.release(1, "browser", first);
  await release;
  const next = await services.takeover(1, "browser");
  await expect(stale).rejects.toThrow("失效");
  await expect(
    services.run(1, "browser", "task", signal(), async () => {}),
  ).rejects.toThrow("接管");
  await services.release(1, "browser", next);
});
