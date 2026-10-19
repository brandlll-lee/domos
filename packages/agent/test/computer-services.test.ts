import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { expect, onTestFinished, test } from "vitest";
import { Computer } from "../src/computer/index.ts";
import { parseConfig } from "../src/runtime/config.ts";

test("browser profiles persist across a restart and stay separate for each Bot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-profile-"));
  const config = parseConfig(
    { dataDir: directory },
    join(directory, "config.json"),
  );
  let computer = new Computer(config);
  const server = createServer((_request, response) =>
    response.end("<title>Workspace</title>"),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Address required");
  const url = `http://127.0.0.1:${address.port}`;
  const call = (botId: number, name: string, args: Record<string, unknown>) =>
    computer.services.call(
      botId,
      "browser",
      name,
      args,
      "profile",
      new AbortController().signal,
      context,
    );
  onTestFinished(async () => {
    await computer.close(context);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
  });
  expect(
    (await computer.services.prepare(1, "browser", context)).available,
  ).toBe(true);
  await call(1, "agent_browser_open", { url });
  const viewId = crypto.randomUUID();
  const signal = AbortSignal.timeout(10000);
  await computer.services.viewer(
    1,
    { operation: "view", service: "browser", id: viewId, action: "open" },
    signal,
    context,
  );
  const frame = await computer.services.viewer<{
    seq: number;
    data: string;
    width: number;
    height: number;
  }>(
    1,
    { operation: "view", service: "browser", id: viewId, action: "next" },
    signal,
    context,
  );
  expect(frame.width).toBeGreaterThan(0);
  expect(frame.height).toBeGreaterThan(0);
  expect(Buffer.from(frame.data, "base64").length).toBeGreaterThan(100);
  await computer.services.viewer(
    1,
    {
      operation: "view",
      service: "browser",
      id: viewId,
      action: "send",
      message: { type: "ack", seq: frame.seq },
    },
    signal,
    context,
  );
  await computer.services.viewer(
    1,
    { operation: "view", service: "browser", id: viewId, action: "close" },
    signal,
    context,
  );
  await computer.services.prepare(1, "browser", context);
  expect(
    JSON.stringify((await call(1, "agent_browser_get_url", {})).content),
  ).toContain(url);
  expect(
    (
      await call(1, "agent_browser_eval", {
        script: "localStorage.setItem('marker', 'saved')",
      })
    ).isError,
  ).toBe(false);
  await computer.close(context);
  computer = new Computer(config);
  expect(
    (await computer.services.prepare(1, "browser", context)).available,
  ).toBe(true);
  await call(1, "agent_browser_open", { url });
  const first = await call(1, "agent_browser_eval", {
    script: "localStorage.getItem('marker')",
  });
  expect(JSON.stringify(first.content)).toContain("saved");
  expect(
    (await computer.services.prepare(2, "browser", context)).available,
  ).toBe(true);
  await call(2, "agent_browser_open", { url });
  const second = await call(2, "agent_browser_eval", {
    script: "localStorage.getItem('marker')",
  });
  expect(JSON.stringify(second.content)).not.toContain("saved");
  const blocked = call(2, "agent_browser_eval", {
    script: "new Promise(resolve => setTimeout(() => resolve('late'), 30000))",
  }).catch((error: Error) => error.message);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const lease = await computer.services.takeover(2, "browser");
  expect(await blocked).toContain("待核对");
  await computer.services.release(2, "browser", lease);
}, 60000);

test.runIf(platform() === "win32")(
  "a shared desktop keeps one task owner and gives control to the user",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "domos-services-"));
    const computer = new Computer(
      parseConfig({ dataDir: directory }, join(directory, "config.json")),
    );
    onTestFinished(async () => {
      await computer.close(context);
      await rm(directory, { recursive: true, force: true, maxRetries: 5 });
    });
    expect(await computer.services.prepare(1, "desktop", context)).toEqual({
      available: true,
      error: null,
    });
    const tools = await computer.services.catalog(1, "desktop", context);
    expect(tools.some((tool) => tool.name === "get_desktop_state")).toBe(true);
    const call = (botId: number, owner: string) =>
      computer.services.call(
        botId,
        "desktop",
        "get_desktop_state",
        { max_image_dimension: 320 },
        owner,
        new AbortController().signal,
        context,
      );
    expect((await call(1, "first")).isError).toBe(false);
    await expect(call(2, "second")).rejects.toThrow("其他任务");
    const lease = await computer.services.takeover(1, "desktop");
    await expect(call(1, "first")).rejects.toThrow("用户正在接管");
    await expect(
      computer.services.release(1, "desktop", "other"),
    ).rejects.toThrow();
    await computer.services.release(1, "desktop", lease);
    expect((await call(1, "first")).isError).toBe(false);
    computer.services.finish("first");
    expect((await call(2, "second")).isError).toBe(false);
  },
);
