import { characterNames, characterSeed } from "@domos/ui/characters";
import { expect } from "@playwright/test";
import { test } from "./fixtures/service.ts";

test("identity labels retain long names and inline marks for each Harness", async ({
  service,
  page,
}, info) => {
  test.setTimeout(60_000);
  const rpc = async (method: string, json: object) => {
    const response = await page.request.post(`${service.url}/rpc/${method}`, {
      data: { json },
    });
    expect(response.ok()).toBe(true);
    return (await response.json()).json;
  };
  const name = "研究与交付助手 Research and Delivery Companion";
  const bot = await rpc("bots/create", {
    name,
    requestId: crypto.randomUUID(),
  });
  await page.goto(service.url);
  await page.getByRole("link", { name, exact: false }).click();
  for (const provider of ["pi", "codex", "claude", "opencode"]) {
    const profile = await rpc("engines/get", { botId: bot.id });
    await rpc("engines/configure", {
      botId: bot.id,
      config: { provider, model: null },
      revision: profile.revision,
      requestId: crypto.randomUUID(),
    });
    await page.reload();
    const identity = page.locator(".chat-identity");
    const label = identity.locator(".chat-identity-label");
    const mark = label.locator(".engine-mark");
    await expect(mark).toHaveAttribute("data-provider", provider);
    await expect(mark).toHaveCSS("width", "12px");
    await expect(identity.locator(".chat-identity-name")).toHaveAttribute(
      "title",
      name,
    );
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(identity.locator(".chat-identity-avatar")).toHaveCSS(
        "background-color",
        "rgba(0, 0, 0, 0)",
      );
      const boxes = await label.evaluate((node) => {
        const logo = node
          .querySelector(".engine-mark")
          ?.getBoundingClientRect();
        const text = node
          .querySelector(".chat-identity-name")
          ?.getBoundingClientRect();
        if (!logo || !text) throw new Error("Identity label missing");
        const frame = node.getBoundingClientRect();
        return {
          gap: text.x - logo.right,
          alignment: Math.abs(
            logo.y + logo.height / 2 - text.y - text.height / 2,
          ),
          vertical: Math.abs(
            text.y + text.height / 2 - frame.y - frame.height / 2,
          ),
          horizontal: Math.abs(
            (logo.x + text.right) / 2 - frame.x - frame.width / 2,
          ),
        };
      });
      expect(boxes.gap).toBe(4);
      expect(boxes.alignment).toBeLessThan(1);
      expect(boxes.vertical).toBeLessThan(1);
      expect(boxes.horizontal).toBeLessThan(1);
      await identity.screenshot({
        path: info.outputPath(`identity-${provider}-${theme}.png`),
      });
    }
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.keyboard.press("Escape");
  const identity = page.locator(".chat-identity");
  await expect(identity).toBeInViewport();
  expect(
    await identity
      .locator(".chat-identity-name")
      .evaluate((node) => node.scrollWidth > node.clientWidth),
  ).toBe(true);
  await identity.locator(".chat-identity-avatar").click();
  await expect(
    page.getByRole("dialog", { name: "Bot详情", exact: true }),
  ).toBeVisible();
});

test("working identity follows live activity and shares equipment across every shape", async ({
  service,
  page,
}, info) => {
  test.setTimeout(90_000);
  const rpc = async (method: string, json: object = {}) => {
    const response = await page.request.post(`${service.url}/rpc/${method}`, {
      data: { json },
    });
    expect(response.ok()).toBe(true);
    return (await response.json()).json;
  };
  const bot = (await rpc("bots/list"))[0];
  const snapshot = await rpc("get", { botId: bot.id });
  await page.addInitScript((initial) => {
    const fetch = window.fetch.bind(window);
    Reflect.set(window, "activityArrivals", 0);
    document.addEventListener("animationstart", (event) => {
      if ((event as AnimationEvent).animationName === "character-work-arrival")
        Reflect.set(
          window,
          "activityArrivals",
          Reflect.get(window, "activityArrivals") + 1,
        );
    });
    window.fetch = async (...args) => {
      const input = args[0];
      const address = input instanceof Request ? input.url : String(input);
      if (!address.endsWith("/rpc/changes")) return fetch(...args);
      return new Response(
        new ReadableStream({
          start(controller) {
            const deliver = (event: unknown) =>
              controller.enqueue(
                new TextEncoder().encode(
                  `event: message\ndata: ${JSON.stringify({ json: event })}\n\n`,
                ),
              );
            Reflect.set(window, "deliverWorkActivity", deliver);
            Reflect.set(window, "disconnectWorkActivity", () =>
              controller.error(new TypeError("Connection lost")),
            );
            const view = Reflect.get(window, "workActivityView") ?? initial;
            deliver({ type: "snapshot", view });
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    };
  }, snapshot);
  await page.goto(service.url);
  const header = page.locator(".chat-identity");
  const character = header.locator(".character");
  const status = header.locator(".chat-identity-status");
  await expect(header).toBeVisible();
  await expect(status).toBeEmpty();
  const idleWidth = (await header.locator(".chat-identity-label").boundingBox())
    ?.width;
  const top = await page.locator(".chat-header").boundingBox();
  const run = {
    turnId: "work",
    sessionId: snapshot.id,
    status: "running",
    provider: "codex",
    model: "test",
    startedAt: Date.now(),
  };
  const tool = {
    id: "read",
    turnId: "work",
    role: "assistant",
    stopped: false,
    content: [
      {
        type: "toolCall",
        id: "read",
        name: "Read",
        arguments: { path: "private-path" },
        key: "read",
      },
    ],
  };
  const state = {
    ...snapshot,
    busy: true,
    processing: true,
    activeTurnId: "work",
    runs: [run],
    activity: [
      {
        botId: bot.id,
        sessionId: snapshot.id,
        executionId: "work",
        processing: true,
      },
    ],
    messages: [tool],
  };
  const deliver = async () =>
    page.evaluate((view) => {
      Reflect.set(window, "workActivityView", view);
      Reflect.get(window, "deliverWorkActivity")({ type: "snapshot", view });
    }, state);
  await deliver();
  await expect(status).toHaveText("正在读取文件");
  expect(
    (await header.locator(".chat-identity-label").boundingBox())?.width,
  ).toBe(idleWidth);
  await expect(status).toHaveCSS("font-size", "11px");
  await expect(character).toHaveAttribute("data-work", "working");
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "activityArrivals")))
    .toBe(1);
  await expect(character).not.toHaveAttribute("data-entering");
  await page.getByRole("tab", { name: "Work", exact: true }).click();
  await expect(page.locator(".work-row").first()).toContainText("正在读取文件");
  const result = {
    id: "result",
    turnId: "work",
    role: "toolResult",
    toolCallId: "read",
    toolStatus: "done",
    stopped: false,
    content: [],
  };
  await page.evaluate(
    (message) =>
      Reflect.get(
        window,
        "deliverWorkActivity",
      )({ type: "update", state: {}, messages: [message], removed: [] }),
    result,
  );
  await expect(status).toHaveText("正在工作");
  const reply = {
    id: "reply",
    turnId: "work",
    role: "assistant",
    stopped: false,
    pending: true,
    content: [{ type: "text", key: "reply", text: "正在整理结果。" }],
  };
  await page.evaluate(
    (message) =>
      Reflect.get(
        window,
        "deliverWorkActivity",
      )({ type: "update", state: {}, messages: [message], removed: [] }),
    reply,
  );
  await expect(status).toHaveText("正在回复");
  const labelWidth = (
    await header.locator(".chat-identity-label").boundingBox()
  )?.width;
  for (const [waiting, label] of [
    ["等待你的回答。", "等你回答"],
    ["等待你的确认。", "等你确认"],
    ["等待你完成接管。", "等你完成接管"],
  ]) {
    await page.evaluate(
      (waiting) =>
        Reflect.get(
          window,
          "deliverWorkActivity",
        )({
          type: "update",
          state: {
            activity: [
              {
                botId: 1,
                sessionId: 1,
                executionId: "work",
                processing: false,
                waiting,
              },
            ],
          },
          messages: [],
          removed: [],
        }),
      waiting,
    );
    await expect(status).toHaveText(label ?? "");
    await expect(character).toHaveAttribute("data-work", "waiting");
    await expect(character.locator(".character-computer-motion")).toHaveCSS(
      "animation-name",
      "none",
    );
    expect(
      (await header.locator(".chat-identity-label").boundingBox())?.width,
    ).toBe(labelWidth);
  }
  await page.evaluate(
    (run) =>
      Reflect.get(
        window,
        "deliverWorkActivity",
      )({
        type: "update",
        state: { runs: [{ ...run, status: "stopping" }] },
        messages: [],
        removed: [],
      }),
    run,
  );
  await expect(status).toHaveText("正在停止");
  expect(await page.locator(".chat-header").boundingBox()).toEqual(top);
  await page.evaluate(() => Reflect.get(window, "disconnectWorkActivity")());
  await expect(status).toBeEmpty();
  await expect(character).not.toHaveAttribute("data-work");
  await expect(status).toHaveText("正在读取文件");
  expect(
    await page.evaluate(() => Reflect.get(window, "activityArrivals")),
  ).toBe(1);
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await header.screenshot({
      path: info.outputPath(`working-identity-${theme}.png`),
    });
  }
  state.busy = false;
  state.runs = [{ ...run, status: "failed" }];
  await deliver();
  await expect(status).toBeEmpty();
  expect(
    (await header.locator(".chat-identity-label").boundingBox())?.width,
  ).toBe(idleWidth);
  await expect(character).not.toHaveAttribute("data-work");
  state.busy = true;
  state.activeTurnId = "next";
  state.runs = [{ ...run, turnId: "next" }];
  state.activity = [
    {
      ...state.activity[0],
      botId: bot.id,
      sessionId: snapshot.id,
      executionId: "next",
      processing: true,
    },
  ];
  state.messages = [];
  await deliver();
  await expect(status).toHaveText("正在工作");
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "activityArrivals")))
    .toBe(2);
  await expect(character).not.toHaveAttribute("data-entering");
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const shape of Object.keys(
    characterNames,
  ) as (keyof typeof characterNames)[]) {
    const sample = await rpc("bots/create", {
      name: `材质检查 ${shape}`,
      avatar: characterSeed(shape, "#91df74"),
      requestId: crypto.randomUUID(),
    });
    await page.getByRole("link", { name: sample.name, exact: false }).click();
    await expect(character).toHaveAttribute("data-shape", shape);
    await expect(character).toHaveAttribute("data-work", "working");
    await expect(character.locator(".character-work-headset")).toHaveCSS(
      "opacity",
      "1",
    );
    await expect(character.locator(".character-work-computer")).toHaveCSS(
      "opacity",
      "1",
    );
    await expect(character.locator(".character-body")).toHaveCSS(
      "animation-name",
      "none",
    );
    const geometry = await header.evaluate((element) => {
      const computer = element
        .querySelector(".character-computer-motion")
        ?.getBoundingClientRect();
      const text = element
        .querySelector(".chat-identity-title")
        ?.getBoundingClientRect();
      if (!computer || !text) throw new Error("Working identity required");
      return { laptopBottom: computer.bottom, textTop: text.top };
    });
    expect(geometry.laptopBottom).toBeLessThanOrEqual(geometry.textTop + 1);
    await header.screenshot({
      path: info.outputPath(`working-shape-${shape}.png`),
    });
  }
  await page.setViewportSize({ width: 390, height: 800 });
  await page.keyboard.press("Escape");
  await expect(header).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await header.click();
  await expect(
    page.getByRole("dialog", { name: "Bot详情", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(header).toBeFocused();
  await header.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Bot详情", exact: true }),
  ).toBeVisible();
});

test("chat identity stays painted above live message transitions and the top fade", async ({
  service,
  page,
}, info) => {
  test.setTimeout(60_000);
  const botId = (
    await (await page.request.post(`${service.url}/rpc/bots/list`)).json()
  ).json[0].id;
  const snapshot = (
    await (
      await page.request.post(`${service.url}/rpc/get`, {
        data: { json: { botId } },
      })
    ).json()
  ).json;
  const time = Date.now();
  const message = {
    id: "long-reply",
    turnId: "work",
    role: "assistant",
    receivedAt: time,
    timestamp: time,
    stopped: false,
    content: [
      {
        type: "text",
        key: "reply",
        text: Array.from(
          { length: 35 },
          (_, index) => `第 ${index + 1} 段：检查消息经过顶部身份区时的显示。`,
        ).join("\n\n"),
      },
    ],
  };
  await page.addInitScript(
    (initial) => {
      const fetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const input = args[0];
        const address = input instanceof Request ? input.url : String(input);
        if (!address.endsWith("/rpc/changes")) return fetch(...args);
        return new Response(
          new ReadableStream({
            start(controller) {
              const deliver = (event: unknown) =>
                controller.enqueue(
                  new TextEncoder().encode(
                    `event: message\ndata: ${JSON.stringify({ json: event })}\n\n`,
                  ),
                );
              Reflect.set(window, "deliverIdentityMessage", deliver);
              deliver({ type: "snapshot", view: initial });
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      };
    },
    {
      ...snapshot,
      busy: true,
      processing: true,
      activeTurnId: "work",
      runs: [
        {
          turnId: "work",
          sessionId: snapshot.id,
          status: "running",
          provider: "codex",
          model: "test",
          startedAt: time,
        },
      ],
      messages: [message],
    },
  );
  await page.goto(service.url);
  const header = page.locator(".chat-identity");
  await expect(header.locator(".character")).toHaveAttribute(
    "data-work",
    "working",
  );
  await expect(header.locator(".character")).not.toHaveAttribute(
    "data-entering",
  );
  await page.getByRole("button", { name: "展开", exact: true }).first().click();
  await page.locator(".typing-row").scrollIntoViewIfNeeded();
  await page.evaluate(() => document.activeViewTransition?.finished);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setEmulatedMedia", {
      features: [
        { name: "prefers-color-scheme", value: colorScheme },
        { name: "prefers-reduced-transparency", value: "no-preference" },
      ],
    });
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      colorScheme,
    );
    await header.evaluate((node) =>
      Promise.all(
        node
          .getAnimations({ subtree: true })
          .filter((animation) => animation instanceof CSSTransition)
          .map((animation) => animation.finished),
      ),
    );
    await expect(page.locator(".chat-header-fade")).toHaveCSS(
      "backdrop-filter",
      "blur(8px)",
    );
    const area = await header.locator(".chat-identity-title").boundingBox();
    if (!area) throw new Error("Identity title required");
    const reference = (await page.screenshot()).toString("base64");
    const captures: string[] = [];
    const acknowledgements: Promise<unknown>[] = [];
    const capture = (event: { data: string; sessionId: number }) => {
      captures.push(event.data);
      acknowledgements.push(
        session.send("Page.screencastFrameAck", { sessionId: event.sessionId }),
      );
    };
    session.on("Page.screencastFrame", capture);
    await session.send("Page.startScreencast", {
      format: "png",
      everyNthFrame: 1,
    });
    try {
      for (const update of [
        {
          ...message,
          id: `reply-${colorScheme}`,
          receivedAt: time + 1,
          content: [{ type: "text", key: "new", text: "正在核对结果。" }],
        },
        {
          ...message,
          content: [
            {
              ...message.content[0],
              text: `${message.content.at(0)?.text}\n\n补充结果。`,
            },
          ],
        },
        {
          ...message,
          id: `question-${colorScheme}`,
          receivedAt: time + 2,
          content: [],
          approval: {
            state: "pending",
            request: {
              id: `question-${colorScheme}`,
              kind: "question",
              title: "选择下一步",
              detail: "",
              requestedAt: time + 2,
              options: [{ id: "continue", label: "继续" }],
            },
          },
        },
      ]) {
        await page.evaluate(
          (message) =>
            Reflect.get(
              window,
              "deliverIdentityMessage",
            )({
              type: "update",
              state: {},
              messages: [message],
              removed: [],
            }),
          update,
        );
        await page.waitForFunction(() =>
          Boolean(document.activeViewTransition),
        );
        await page.evaluate(() => document.activeViewTransition?.finished);
      }
      await page.screenshot({
        path: info.outputPath(`chat-edge-fade-${colorScheme}.png`),
      });
    } finally {
      session.off("Page.screencastFrame", capture);
      await session.send("Page.stopScreencast");
      await Promise.all(acknowledgements);
      await session.detach();
    }
    expect(captures.length).toBeGreaterThan(2);
    const differences = await page.evaluate(
      async ({ reference, captures, area }) => {
        const pixels = async (data: string) => {
          const image = new Image();
          image.src = `data:image/png;base64,${data}`;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(area.width);
          canvas.height = Math.floor(area.height);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Canvas required");
          context.drawImage(image, -Math.floor(area.x), -Math.floor(area.y));
          return context.getImageData(0, 0, canvas.width, canvas.height).data;
        };
        const baseline = await pixels(reference);
        return Promise.all(
          captures.map(async (capture) => {
            const frame = await pixels(capture);
            return (
              frame.reduce((sum, value, index) => {
                const original = baseline[index];
                if (original === undefined)
                  throw new Error("Frame size changed");
                return sum + Math.abs(value - original);
              }, 0) / frame.length
            );
          }),
        );
      },
      { reference, captures, area },
    );
    const worst = Math.max(...differences);
    await info.attach(`identity-frames-${colorScheme}.json`, {
      body: JSON.stringify({ frames: captures.length, differences }),
      contentType: "application/json",
    });
    await info.attach(`identity-paint-${colorScheme}.png`, {
      body: Buffer.from(
        captures.at(differences.indexOf(worst)) ?? "",
        "base64",
      ),
      contentType: "image/png",
    });
    expect(worst).toBeLessThan(5);
    await expect(header.locator(".character")).not.toHaveAttribute(
      "data-entering",
    );
  }
  const fade = await page.locator(".chat-header-fade").evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      mask: style.maskImage,
      blur: style.backdropFilter,
      pointer: style.pointerEvents,
      reduced:
        matchMedia("(prefers-reduced-transparency: reduce)").matches ||
        matchMedia("(forced-colors: active)").matches,
    };
  });
  expect(fade.mask).toContain("linear-gradient");
  expect(fade.blur).toBe(fade.reduced ? "none" : "blur(8px)");
  expect(fade.pointer).toBe("none");
});
