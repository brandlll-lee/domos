import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { expect, test, vi } from "vitest";
import type { Computers } from "../src/computer/catalog.ts";
import { ComputerServices } from "../src/computer/services.ts";
import { ComputerTools } from "../src/computer/tools.ts";
import { ComputerViews } from "../src/computer/views.ts";
import type { Files } from "../src/files.ts";
import { computerEvidence } from "../src/harness/evidence.ts";
import type { WorkProcess } from "../src/harness/process.ts";

const signal = () => new AbortController().signal;

test("desktop cancellation reaches the browser settlement before dispatch", async () => {
  const entered = Promise.withResolvers<void>();
  const pending = Promise.withResolvers<void>();
  let settlingSignal: AbortSignal | undefined;
  const services = new ComputerServices(
    async () =>
      ({
        closed: new Promise(() => {}),
        computer: async (
          request: { operation: string },
          signal?: AbortSignal,
        ) => {
          if (request.operation === "settle") {
            settlingSignal = signal;
            entered.resolve();
            await pending.promise;
          }
          return { available: true };
        },
      }) as unknown as WorkProcess,
  );
  await services.prepare(1, "browser", context);
  const controller = new AbortController();
  const action = vi.fn(async () => {});
  const call = expect(
    services.run(1, "desktop", "task", controller.signal, action),
  ).rejects.toThrow();
  await entered.promise;
  controller.abort();
  pending.resolve();
  await call;
  expect(settlingSignal?.aborted).toBe(true);
  expect(action).not.toHaveBeenCalled();
});

test("Bots share one desktop host and retain separate browser workers", async () => {
  const open = vi.fn(
    async () =>
      ({
        closed: new Promise(() => {}),
        computer: vi.fn(async () => ({ available: true })),
      }) as unknown as WorkProcess,
  );
  const services = new ComputerServices(open);
  await Promise.all([
    services.prepare(1, "desktop", context),
    services.prepare(2, "desktop", context),
  ]);
  expect(open).toHaveBeenCalledTimes(1);
  await Promise.all([
    services.prepare(1, "browser", context),
    services.prepare(2, "browser", context),
  ]);
  expect(open).toHaveBeenCalledTimes(3);
});

test.each(["browser", "desktop"] as const)(
  "mode switching preserves a viewer that owns %s control",
  async (service) => {
    const services = new ComputerServices(async () => {
      throw new Error("Worker must stay idle");
    });
    const lease = await services.takeover(1, service);
    const closeBot = vi.fn();
    const tools = new ComputerTools({
      transfer: async (_id: number, work: () => unknown) => work(),
      serviceTarget: async () => ({
        id: "pc",
        target: { services },
        enabled: { browser: true },
      }),
      views: { closeBot },
    } as unknown as Computers);
    await expect(tools.browserMode(1, "headed", context)).rejects.toThrow(
      "另一窗口",
    );
    expect(closeBot).not.toHaveBeenCalled();
    services.viewAccess(1, service, lease);
    await services.release(1, service, lease);
  },
);

test("mode switching holds browser and desktop control and releases both after failure", async () => {
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  let headed = false;
  const worker = {
    closed: new Promise(() => {}),
    computer: vi.fn(async (request: { operation: string; mode?: string }) => {
      if (request.operation === "mode") {
        started.resolve();
        await finish.promise;
        headed = request.mode === "headed";
      }
      return {
        available: true,
        error: null,
        sharedDesktop: headed,
        mode: headed ? "headed" : "headless",
      };
    }),
  };
  const services = new ComputerServices(
    async () => worker as unknown as WorkProcess,
  );
  await services.prepare(1, "browser", context);
  const lease = await services.takeover(1, "browser");
  await expect(services.mode(1, "headed", context)).rejects.toThrow("交还");
  await services.release(1, "browser", lease);
  const switching = services.mode(1, "headed", context);
  await started.promise;
  for (const service of ["browser", "desktop"] as const)
    expect(() => services.viewAccess(1, service)).toThrow("另一窗口");
  finish.resolve();
  expect(await switching).toMatchObject({ mode: "headed" });
  const shared = await services.takeover(1, "desktop");
  expect(() => services.viewAccess(1, "browser")).toThrow("另一窗口");
  await services.release(1, "desktop", shared);
  worker.computer.mockRejectedValueOnce(new Error("Display unavailable"));
  await expect(services.mode(1, "headless", context)).rejects.toThrow(
    "Display unavailable",
  );
  services.viewAccess(1, "desktop");
  services.viewAccess(1, "browser");
});

test.each(["browser", "desktop"] as const)(
  "%s keeps its own frames during first takeover and drains before input",
  async (service) => {
    const settling = Promise.withResolvers<void>();
    const settled = Promise.withResolvers<void>();
    const worker = {
      closed: new Promise(() => {}),
      computer: vi.fn(async (request: { operation: string }) => {
        if (request.operation === "settle") {
          settling.resolve();
          await settled.promise;
        }
        return { available: true, sharedDesktop: true };
      }),
    };
    const services = new ComputerServices(
      async () => worker as unknown as WorkProcess,
    );
    const target = { services };
    const views = new ComputerViews({
      serviceTarget: async () => ({
        target,
        id: "pc",
        enabled: { browser: true, desktop: true },
      }),
    } as unknown as Computers);
    const id = await views.open(1, service, signal(), context);
    const other = await views.open(1, service, signal(), context);
    const taking = views.action(1, id, { type: "take" }, signal(), context);
    await settling.promise;
    try {
      await views.next(1, id, signal(), context);
      await views.action(1, id, { type: "ack", seq: 1 }, signal(), context);
      await expect(
        views.action(1, id, { type: "text", text: "early" }, signal(), context),
      ).rejects.toThrow("交接");
      await expect(views.next(1, other, signal(), context)).rejects.toThrow(
        "另一窗口",
      );
      const repeated = views.action(1, id, { type: "take" }, signal(), context);
      settled.resolve();
      expect(await taking).toEqual({ controlling: true });
      expect(await repeated).toEqual({ controlling: true });
      await views.action(
        1,
        id,
        { type: "text", text: "ready" },
        signal(),
        context,
      );
      await views.close(id, context);
      await views.next(1, other, signal(), context);
    } finally {
      settled.resolve();
      await taking.catch(() => {});
      await views.close(id, context);
      await views.close(other, context);
    }
  },
);

test.each([false, true])(
  "closing during takeover releases its reservation after settle (failure=%s)",
  async (fails) => {
    const started = Promise.withResolvers<void>();
    const done = Promise.withResolvers<void>();
    let hold = true;
    const services = new ComputerServices(
      async () =>
        ({
          closed: new Promise(() => {}),
          computer: async (request: { operation: string }) => {
            if (request.operation === "settle" && hold) {
              started.resolve();
              await done.promise;
              if (fails) throw new Error("settle failed");
            }
            return { available: true, sharedDesktop: true };
          },
        }) as unknown as WorkProcess,
    );
    const target = { services };
    const views = new ComputerViews({
      serviceTarget: async () => ({
        target,
        id: "pc",
        enabled: { browser: true },
      }),
    } as unknown as Computers);
    const id = await views.open(1, "browser", signal(), context);
    const taking = views.action(1, id, { type: "take" }, signal(), context);
    const rejected = expect(taking).rejects.toThrow(
      fails ? "settle failed" : "断开",
    );
    await started.promise;
    const closing = views.close(id, context);
    expect(() => services.viewAccess(1, "browser")).toThrow("另一窗口");
    done.resolve();
    await rejected;
    await closing;
    services.viewAccess(1, "browser");
    hold = false;
    const next = await views.open(1, "browser", signal(), context);
    await views.action(1, next, { type: "take" }, signal(), context);
    await views.close(next, context);
  },
);
test("takeover completion requires the matching viewer and closes input before releasing control", async () => {
  const order: string[] = [];
  const closed = Promise.withResolvers<void>();
  const services = {
    viewAccess: () => {},
    prepare: async () => ({ available: true }),
    takeover: async () => "lease",
    release: async () => {
      order.push("released");
    },
    viewer: async (_botId: number, request: { action: string }) => {
      if (request.action === "close") {
        order.push("closing");
        await closed.promise;
        order.push("closed");
      }
      return {};
    },
  };
  const target = { services };
  const views = new ComputerViews({
    serviceTarget: async () => ({
      target,
      id: "pc",
      enabled: { browser: true, desktop: true },
    }),
  } as unknown as Computers);
  const id = await views.open(1, "browser", signal(), context);
  await expect(
    views.takeRequest(2, id, "request", "browser", "pc", context),
  ).rejects.toThrow("失效");
  await expect(
    views.takeRequest(1, id, "request", "desktop", "pc", context),
  ).rejects.toThrow("目标");
  await expect(views.finishRequest(1, "request", context)).rejects.toThrow(
    "接管",
  );
  await views.takeRequest(1, id, "request", "browser", "pc", context);
  await expect(views.finishRequest(1, "another", context)).rejects.toThrow(
    "接管",
  );
  const closing = views.close(id, context);
  await expect.poll(() => order).toEqual(["closing"]);
  closed.resolve();
  await closing;
  expect(order).toEqual(["closing", "closed", "released"]);
  await expect(views.finishRequest(1, "request", context)).rejects.toThrow(
    "接管",
  );
});
test.each([
  "browser_agent_browser_click",
  "browser_agent_browser_eval",
  "run_steps",
  "run_script",
])("%s requires shared approval", async (name) => {
  const services = {
    catalog: async (_id: number, service: string) => [
      {
        name: name.startsWith("browser_")
          ? name.slice(service.length + 1)
          : name,
        inputSchema: {},
      },
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
        desktop: !name.startsWith("browser"),
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

test("Stop retains control until an issued desktop action settles", async () => {
  const services = new ComputerServices(async () => {
    throw new Error("Worker must stay idle");
  });
  const entered = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const controller = new AbortController();
  const first = expect(
    services.run(1, "desktop", "computer:1", controller.signal, async () => {
      entered.resolve();
      await finish.promise;
    }),
  ).rejects.toThrow("待核对");
  await entered.promise;
  controller.abort();
  services.finish("computer:1");
  const next = vi.fn(async () => {});
  await expect(
    services.run(1, "desktop", "computer:1", signal(), next),
  ).rejects.toThrow("尚未收束");
  expect(next).not.toHaveBeenCalled();
  finish.resolve();
  await first;
  await services.run(1, "desktop", "computer:1", signal(), next);
  expect(next).toHaveBeenCalledOnce();
});
