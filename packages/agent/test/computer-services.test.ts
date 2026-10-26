import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { expect, onTestFinished, test } from "vitest";
import type { ComputerActivity } from "../src/computer/activity.ts";
import { assistInput } from "../src/computer/assistant-action.ts";
import { verify } from "../src/computer/assistant-observation.ts";
import { Computer } from "../src/computer/index.ts";
import { parseConfig } from "../src/runtime/config.ts";

test("cold browser commands return facts and batches preserve real page results", async () => {
  const entry = "../src/harness/browser-service.mjs";
  const { openBrowserService } = await import(entry);
  const directory = await mkdtemp(join(tmpdir(), "domos-browser-latency-"));
  const browser = await openBrowserService(directory, directory);
  onTestFinished(async () => {
    await browser.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
  });
  const rows: {
    name: string;
    elapsedMs: number;
    timing: string | undefined;
  }[] = [];
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const start = performance.now();
    const result = await browser.call(name, args, AbortSignal.timeout(20000));
    rows.push({
      name,
      elapsedMs: performance.now() - start,
      timing: result.content.find((part: { text?: string }) =>
        part.text?.startsWith("Domos browser timing"),
      )?.text,
    });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    return result;
  };
  await call("agent_browser_tab_list");
  expect(rows[0]?.elapsedMs).toBeLessThan(10000);
  await call("agent_browser_open", {
    url: "data:text/html,<title>Actions</title><input id='draft'><button id='confirm' onclick='this.textContent=document.querySelector(\"input\").value'>Confirm</button>",
  });
  const batch = await call("agent_browser_run_steps", {
    steps: [
      { action: "fill", selector: "#draft", text: "Confirmed" },
      { action: "click", selector: "#confirm" },
    ],
  });
  expect(batch.structuredContent.completed).toBe(2);
  expect(JSON.stringify(batch.content)).toContain("Confirmed");
  for (const [title, text] of [
    ["Blank", ""],
    ["Loading", "Loading…"],
    ["Error", "Service unavailable"],
  ]) {
    const result = await call("agent_browser_open", {
      url: `data:text/html;charset=utf-8,${encodeURIComponent(`<title>${title}</title><body>${text}</body>`)}`,
    });
    const facts = result.content.find((part: { text?: string }) =>
      part.text?.startsWith("Page facts"),
    );
    const page = JSON.parse(
      facts.text.slice("Page facts (untrusted website data): ".length),
    );
    expect(page).toMatchObject({ title, text, readyState: "complete" });
    expect(JSON.stringify(result.content)).toContain("alone does not explain");
  }
  await mkdir("test-results", { recursive: true });
  await writeFile(
    `test-results/browser-latency-${platform()}.json`,
    JSON.stringify(
      { runner: platform(), browserVersion: "0.39.4", model: "none", rows },
      null,
      2,
    ),
  );
}, 60000);

test("browser profiles persist across a restart and stay separate for each Bot", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), `domos-profile-${"workspace-".repeat(4)}`),
  );
  const config = parseConfig(
    { dataDir: directory },
    join(directory, "config.json"),
  );
  let computer = new Computer(config);
  const started = Promise.withResolvers<void>();
  const server = createServer((request, response) => {
    if (request.url === "/started") started.resolve();
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(
      '<title>Workspace</title><input aria-label="Draft" id="draft" value="saved draft"><button id="confirm" onclick="this.textContent=String.fromCharCode(79,75)">Confirm</button>',
    );
  });
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
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
  });
  expect(await computer.services.prepare(1, "browser", context)).toEqual({
    available: true,
    error: null,
  });
  const opened = await call(1, "agent_browser_open", { url });
  expect(opened.isError, JSON.stringify(opened.content)).not.toBe(true);
  const screenshot = await call(1, "agent_browser_screenshot", {});
  expect(screenshot.structuredContent?.source).toMatchObject({
    url: `${url}/`,
    capturedAt: expect.any(String),
  });
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
  const controller = new AbortController();
  const running = computer.services
    .call(
      1,
      "browser",
      "agent_browser_eval",
      {
        script:
          "new Promise(resolve => { document.querySelector('#draft').value = 'in progress'; document.querySelector('#draft').focus(); fetch('/started'); setTimeout(() => resolve('done'), 500); })",
      },
      "profile",
      controller.signal,
      context,
    )
    .catch((error: Error) => error.message);
  await started.promise;
  const lease1 = await computer.services.takeover(1, "browser");
  expect(await running).toContain("待核对");
  await computer.services.release(1, "browser", lease1);
  expect(
    JSON.stringify(
      (
        await call(1, "agent_browser_eval", {
          script: "document.querySelector('#draft').value",
        })
      ).content,
    ),
  ).toContain("in progress");
  const proof = assistInput.parse({
    service: "browser",
    goal: "Fill draft",
    completion: "Draft contains in progress",
    evidence: { role: "textbox", label: "Draft", value: "in progress" },
  });
  expect(
    await verify(
      proof,
      (name, args) => call(1, name, args),
      AbortSignal.timeout(5000),
    ),
  ).toBeDefined();
  if (!proof.evidence) throw new Error("Evidence required");
  proof.evidence.value = "different";
  proof.evidence.timeout_ms = 100;
  expect(
    await verify(
      proof,
      (name, args) => call(1, name, args),
      AbortSignal.timeout(5000),
    ),
  ).toBeUndefined();
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
  const lease = await computer.services.takeover(2, "browser");
  await computer.services.release(2, "browser", lease);
}, 60000);

test("a native lost response keeps late effects paused until browser restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-browser-outcome-"));
  const computer = new Computer(
    parseConfig({ dataDir: directory }, join(directory, "config.json")),
  );
  onTestFinished(async () => {
    await computer.close(context);
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
  });
  const call = (name: string, args: Record<string, unknown> = {}) =>
    computer.services
      .call(
        1,
        "browser",
        name,
        args,
        "outcome",
        AbortSignal.timeout(45000),
        context,
      )
      .catch((error: Error) => {
        throw new Error(`${name}: ${error.message}`);
      });
  expect(
    (await computer.services.prepare(1, "browser", context)).available,
  ).toBe(true);
  await call("agent_browser_open", {
    url: "data:text/html,<title>Outcome</title><body>pending</body>",
  });
  const result = await call("agent_browser_eval", {
    script:
      "new Promise(resolve => setTimeout(() => { document.body.textContent = 'late change'; resolve(1); }, 35000))",
  });
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result.structuredContent)).toMatch(
    /outcome_unknown|CDP command timed out: Runtime.evaluate/,
  );
  await expect(
    call("agent_browser_click", { selector: "body" }),
  ).rejects.toThrow("结果未知");
  await expect(computer.services.takeover(1, "browser")).rejects.toThrow(
    "结果未知",
  );
  await expect
    .poll(
      async () =>
        JSON.stringify(
          (await call("agent_browser_get_text", { selector: "body" })).content,
        ),
      { timeout: 10000 },
    )
    .toContain("late change");
  await call("agent_browser_restart");
  expect(
    JSON.stringify((await call("agent_browser_get_url")).content),
  ).toContain("about:blank");
  const lease = await computer.services.takeover(1, "browser");
  await computer.services.release(1, "browser", lease);
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
    const controller = new AbortController();
    let latest: ComputerActivity = null;
    const watching = (async () => {
      for await (const state of computer.services.activity(
        1,
        controller.signal,
        context,
      ))
        latest = state;
    })().catch(() => {});
    onTestFinished(async () => {
      controller.abort();
      await watching;
    });
    const call = (botId: number, owner: string) =>
      computer.services.call(
        botId,
        "desktop",
        "get_desktop_state",
        { max_image_dimension: 320 },
        owner,
        new AbortController().signal,
        context,
        { botId, color: "#c4789b", owner },
      );
    expect((await call(1, "first")).isError).toBe(false);
    await expect
      .poll(() => latest)
      .toMatchObject({ botId: 1, color: "#c4789b" });
    await expect(call(2, "second")).rejects.toThrow("其他任务");
    const lease = await computer.services.takeover(1, "desktop");
    await expect.poll(() => latest).toBeNull();
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
