import { once } from "node:events";
import { expect } from "@playwright/test";
import { test } from "./fixtures/service.ts";

test("private chats insert peer Bot references through mentions and the shared menu", async ({
  service,
  page,
}, info) => {
  await page.goto(service.url);
  const response = await page.request.post(`${service.url}/rpc/bots/create`, {
    data: { json: { name: "Reviewer", requestId: crypto.randomUUID() } },
  });
  expect(response.ok()).toBe(true);
  const peer = (await response.json()).json;
  const botId = (
    await (await page.request.post(`${service.url}/rpc/bots/list`)).json()
  ).json.find((bot: { name: string }) => bot.name === "Domos").id;
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(
    page.getByRole("button", { name: "Bot详情", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".chat-identity .team-avatar")).toHaveCount(0);
  await input.pressSequentially("请让 @Rev");
  const picker = page.getByRole("dialog", { name: "选择 Bot", exact: true });
  await expect(
    picker.getByRole("button", { name: "Reviewer", exact: true }),
  ).toBeVisible();
  await input.press("Enter");
  await input.pressSequentially("检查发布");
  await input.press("Home");
  const add = page.getByRole("button", { name: "添加内容", exact: true });
  await add.click();
  await page.getByRole("menuitem", { name: "选择 Bot…", exact: true }).click();
  await expect(
    picker.getByRole("button", { name: "Reviewer", exact: true }),
  ).toBeFocused();
  await expect(
    picker.getByRole("button", { name: "Domos", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("menuitem", { name: "选择 Bot…", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(input.locator('[data-inline-token^="bot:"]')).toHaveCount(2);
  await expect(input).toBeFocused();
  await input.pressSequentially("请问");
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.screenshot({
      path: info.outputPath(`private-bot-references-${theme}.png`),
    });
  }
  await page.reload();
  await expect(input.locator('[data-inline-token^="bot:"]')).toHaveCount(2);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const log = page.getByRole("log", { name: "聊天记录", exact: true });
  await expect(log.locator(".message.user .bot-reference")).toHaveCount(2);
  await expect(log.locator(".typing-row")).toHaveCount(0);
  const view = (
    await (
      await page.request.post(`${service.url}/rpc/get`, {
        data: { json: { botId } },
      })
    ).json()
  ).json;
  const sent = view.messages.find(
    (message: { role: string }) => message.role === "user",
  );
  expect(
    sent.materials.bots
      .map((bot: { position: number }) => bot.position)
      .sort((a: number, b: number) => a - b),
  ).toEqual([0, 6]);
  expect(
    sent.materials.bots.every(
      (bot: { botId: number }) => bot.botId === peer.id,
    ),
  ).toBe(true);
  const peerView = (
    await (
      await page.request.post(`${service.url}/rpc/get`, {
        data: { json: { botId: peer.id } },
      })
    ).json()
  ).json;
  expect(peerView.messages).toEqual([]);
});

test("teams preserve member authors and keep private chats separate", async ({
  service,
  page,
}, info) => {
  await page.goto(service.url);
  await page
    .locator("#bot-details")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  const response = await page.request.post(`${service.url}/rpc/bots/create`, {
    data: { json: { name: "Reviewer", requestId: crypto.randomUUID() } },
  });
  expect(response.ok()).toBe(true);
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page.getByRole("menuitem", { name: "新建团队", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "新建 Bot 团队",
    exact: true,
  });
  const initialFrame = await dialog.boundingBox();
  await expect(
    dialog.getByRole("textbox", { name: "团队名称", exact: true }),
  ).toHaveAttribute("placeholder", "团队名称");
  await expect(
    dialog.getByRole("textbox", { name: "团队用途", exact: true }),
  ).toHaveAttribute("placeholder", "这个团队要做什么？（选填）");
  await dialog.getByLabel("团队名称", { exact: true }).fill("发布小队");
  await dialog.getByLabel("团队用途", { exact: true }).fill("检查本次发布");
  const domosChoice = dialog
    .locator(".team-member")
    .filter({ hasText: "Domos" });
  await domosChoice.locator(".bot-avatar").click();
  await expect(
    dialog.getByRole("checkbox", { name: "Domos", exact: true }),
  ).toBeChecked();
  await dialog.getByRole("checkbox", { name: "Reviewer", exact: true }).check();
  const reviewerChoice = dialog
    .locator(".team-member")
    .filter({ hasText: "Reviewer" });
  await reviewerChoice
    .getByRole("button", { name: "设为负责人", exact: true })
    .click();
  await expect(
    dialog.getByRole("checkbox", { name: "Reviewer", exact: true }),
  ).toBeChecked();
  await expect(
    reviewerChoice.getByRole("button", { name: "默认负责人", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await domosChoice
    .getByRole("button", { name: "设为负责人", exact: true })
    .click();
  const choiceFrame = await domosChoice.boundingBox();
  const checkboxFrame = await domosChoice.getByRole("checkbox").boundingBox();
  const avatarFrame = await domosChoice.locator(".bot-avatar").boundingBox();
  expect(checkboxFrame?.x).toBeGreaterThan(
    (choiceFrame?.x ?? 0) + (choiceFrame?.width ?? 0) / 2,
  );
  expect(checkboxFrame?.x).toBeGreaterThan(avatarFrame?.x ?? 0);
  const frame = await dialog.boundingBox();
  await expect(
    dialog.getByRole("button", { name: "默认负责人", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(frame?.height).toBe(initialFrame?.height);
  expect(frame?.height).toBeGreaterThan(400);
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog
    .getByLabel("团队用途", { exact: true })
    .fill("检查发布内容，保留现有数据。\n".repeat(12));
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect
      .poll(() =>
        dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
      )
      .toBe(true);
    await expect(
      dialog.getByRole("button", { name: "创建", exact: true }),
    ).toBeInViewport();
    await expect(
      dialog.getByRole("checkbox", { name: "Domos", exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: info.outputPath(`team-dialog-${theme}-narrow.png`),
    });
  }
  await dialog.getByLabel("团队用途", { exact: true }).fill("检查本次发布");
  await page.setViewportSize({ width: 1360, height: 900 });
  await dialog.getByRole("button", { name: "创建", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: "团队详情", exact: true }),
  ).toHaveText("发布小队");
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .fill("只在团队讨论发布");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const log = page.getByRole("log", { name: "聊天记录", exact: true });
  await expect(log).toContainText("已收到");
  await expect(log.locator(".message-author")).toContainText("Domos");
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await input.pressSequentially("@Rev");
  await expect(input).toBeFocused();
  await expect(
    page
      .getByRole("dialog", { name: "选择 Bot", exact: true })
      .getByRole("button"),
  ).toHaveCount(1);
  await input.press("ArrowDown");
  await expect(
    page
      .getByRole("dialog", { name: "选择 Bot", exact: true })
      .getByRole("button", { name: "Reviewer", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("dialog", { name: "选择 Bot", exact: true })
    .getByRole("button", { name: "Reviewer", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "选择 Bot", exact: true }),
  ).toBeHidden();
  await input.press("End");
  await page.getByRole("button", { name: "添加内容", exact: true }).click();
  await page.getByRole("menuitem", { name: "选择 Bot…", exact: true }).click();
  await page
    .getByRole("dialog", { name: "选择 Bot", exact: true })
    .getByRole("button", { name: "Domos", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "选择 Bot", exact: true }),
  ).toBeHidden();
  await input.pressSequentially("@Rev");
  await input.press("Enter");
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .pressSequentially("请检查发布说明");
  await expect(page.locator('[data-inline-token^="bot:"]')).toHaveCount(3);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    log.locator(".message .message-author").filter({ hasText: "Reviewer" }),
  ).toBeVisible();
  await expect(log.locator(".typing-row")).toHaveCount(0);
  await expect
    .poll(() =>
      log
        .locator(".bot-reference .character")
        .evaluateAll((elements) =>
          elements.every(
            (element) => getComputedStyle(element).opacity === "1",
          ),
        ),
    )
    .toBe(true);
  const peer = (await response.json()).json;
  const teamId = page.url().split("#team/")[1];
  const viewResponse = await page.request.post(`${service.url}/rpc/teams/get`, {
    data: { json: { id: teamId } },
  });
  const view = (await viewResponse.json()).json;
  const sent = view.messages.find(
    (message: { role: string; materials?: { bots?: unknown[] } }) =>
      message.role === "user" && message.materials?.bots?.length,
  );
  expect(
    sent.materials.bots.map((bot: { position: number }) => bot.position),
  ).toEqual([0, 1, 2]);
  expect(
    sent.materials.bots.map((bot: { botId: number }) => bot.botId),
  ).toEqual([
    peer.id,
    view.runs.find(
      (run: { author?: { name: string } }) => run.author?.name === "Domos",
    ).author.botId,
    peer.id,
  ]);
  expect(sent.materials.bots[0]).toMatchObject({
    name: peer.name,
    avatar: peer.avatar,
  });
  await expect
    .poll(async () => {
      const response = await page.request.post(`${service.url}/rpc/teams/get`, {
        data: { json: { id: teamId } },
      });
      const current = (await response.json()).json;
      return current.runs.filter(
        (run: { author?: { botId: number } }) => run.author?.botId === peer.id,
      ).length;
    })
    .toBe(1);
  expect(
    view.messages.filter(
      (message: { requestId?: string }) => message.requestId === sent.requestId,
    ),
  ).toHaveLength(1);
  expect(
    view.runs.filter(
      (run: { author?: { name: string } }) => run.author?.name === "Domos",
    ),
  ).toHaveLength(2);
  const replay = await page.request.post(`${service.url}/rpc/teams/send`, {
    data: {
      json: {
        id: teamId,
        text: sent.content[0].text,
        requestId: sent.requestId,
        bots: sent.materials.bots.map(
          ({
            id,
            botId,
            position,
          }: {
            id: string;
            botId: number;
            position: number;
          }) => ({ id, botId, position }),
        ),
      },
    },
  });
  expect(replay.ok()).toBe(true);
  const answer = view.messages
    .filter((message: { role: string }) => message.role === "assistant")
    .at(-1);
  expect(JSON.stringify(answer.content).match(/<bot>/g)).toHaveLength(3);
  expect(
    view.runs.find(
      (run: { author?: { botId: number } }) => run.author?.botId === peer.id,
    ).sessionId,
  ).toBe(sent.sessionId);
  const outsider = (
    await (
      await page.request.post(`${service.url}/rpc/bots/create`, {
        data: { json: { name: "Outsider", requestId: crypto.randomUUID() } },
      })
    ).json()
  ).json;
  const rejected = await page.request.post(`${service.url}/rpc/teams/send`, {
    data: {
      json: {
        id: teamId,
        text: "检查",
        requestId: crypto.randomUUID(),
        bots: [{ id: "outside", botId: outsider.id, position: 0 }],
      },
    },
  });
  expect(rejected.status()).toBe(400);
  await page.getByRole("button", { name: "团队详情", exact: true }).click();
  const details = page.locator("#bot-details");
  await expect(
    details.getByRole("heading", { name: "发布小队", exact: true }).last(),
  ).toBeVisible();
  await expect(details.getByText("运行模型", { exact: true })).toHaveCount(0);
  await details.getByRole("button", { name: "团队用途", exact: false }).click();
  const edit = page.getByRole("dialog", { name: "编辑团队", exact: true });
  await expect(edit.getByLabel("团队用途", { exact: true })).toHaveValue(
    "检查本次发布",
  );
  await edit.getByLabel("团队用途", { exact: true }).fill("检查本次发布与回退");
  await edit.getByLabel("团队名称", { exact: true }).fill("发布检查小队");
  await edit.getByRole("button", { name: "保存", exact: true }).click();
  await expect(edit).toBeHidden();
  await expect(details).toContainText("检查本次发布与回退");
  await expect(
    page.getByRole("button", { name: "团队详情", exact: true }),
  ).toHaveText("发布检查小队");
  await details.getByRole("button", { name: "成员 2", exact: false }).click();
  await details.getByRole("button", { name: "Reviewer", exact: true }).click();
  await expect(details).toHaveAttribute("aria-label", "Reviewer的详情");
  await expect(
    details.getByRole("tab", { name: "Computer", exact: true }),
  ).toBeVisible();
  await details.getByRole("button", { name: "返回", exact: true }).click();
  await page.getByRole("tab", { name: "Work", exact: true }).click();
  await expect(
    page
      .locator(".work-row")
      .filter({ hasText: "Reviewer" })
      .locator(".bot-avatar"),
  ).toBeVisible();
  await expect(
    page.locator(".chat-identity .team-avatar .bot-avatar"),
  ).toHaveCount(2);
  await expect(page.locator(".chat-identity-label .engine-mark")).toHaveCount(
    0,
  );
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator(".chat-identity-avatar")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await page.screenshot({ path: info.outputPath(`team-${theme}.png`) });
  }
  const gated = once(service.worker, "message");
  service.worker.send("gate");
  await gated;
  try {
    await input.fill("@Reviewer");
    await page
      .getByRole("dialog", { name: "选择 Bot", exact: true })
      .getByRole("button", { name: "Reviewer", exact: true })
      .click();
    await input.pressSequentially("停止这次审查");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    const active = page
      .locator(".work-row[data-active]")
      .filter({ hasText: "Reviewer" });
    await expect(active).toBeVisible();
    await expect(log.locator(".typing-row")).toContainText("Reviewer");
    await expect(log.locator(".typing-row")).toHaveCount(1);
    const secondGate = once(service.worker, "message");
    service.worker.send("gate");
    await secondGate;
    await input.fill("同时核对另一份发布资料");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(log.locator(".typing-row")).toHaveCount(2);
    await expect(
      log.locator(".typing-row").filter({ hasText: "Domos" }),
    ).toBeVisible();
    await page.reload();
    await expect(log.locator(".typing-row")).toHaveCount(2);
    await page.getByRole("button", { name: "团队详情", exact: true }).click();
    await page.getByRole("tab", { name: "Work", exact: true }).click();
    await expect(
      page.locator("#conversation > section[aria-label='协作任务']"),
    ).toHaveCount(0);
    const composerFrame = await page.locator(".composer-area").boundingBox();
    const request = page.waitForRequest("**/rpc/stop");
    await active.getByRole("button", { name: "停止执行", exact: true }).click();
    expect((await request).postDataJSON().json.botId).toBe(sent.sessionId);
    await expect(active).toHaveCount(0);
    await expect(log.locator(".typing-row")).toHaveCount(1);
    await expect(log.locator(".typing-row")).toContainText("Domos");
    await page
      .locator(".work-row[data-active]")
      .filter({ hasText: "Domos" })
      .getByRole("button", { name: "停止执行", exact: true })
      .click();
    await expect(log.locator(".typing-row")).toHaveCount(0);
    expect((await page.locator(".composer-area").boundingBox())?.y).toBe(
      composerFrame?.y,
    );
  } finally {
    const released = once(service.worker, "message");
    service.worker.send("release");
    await released;
  }
  await page.reload();
  await expect(
    page.getByRole("log", { name: "聊天记录", exact: true }),
  ).toContainText("只在团队讨论发布");
  await page.getByRole("button", { name: "团队详情", exact: true }).click();
  await page.getByRole("tab", { name: "团队", exact: true }).click();
  await details
    .getByRole("button", { name: "默认负责人", exact: false })
    .click();
  await edit.getByRole("checkbox", { name: "Domos", exact: true }).uncheck();
  await expect(edit).toContainText("历史消息会保留");
  await edit.getByRole("button", { name: "保存", exact: true }).click();
  await expect(edit).toBeHidden();
  await expect(
    page.locator(".chat-identity .team-avatar .bot-avatar"),
  ).toHaveCount(1);
  await expect(
    log.locator(".message-author").filter({ hasText: "Domos" }).first(),
  ).toBeVisible();
  await page.getByRole("link", { name: "Domos", exact: true }).click();
  await expect(
    page.getByRole("log", { name: "聊天记录", exact: true }),
  ).not.toContainText("只在团队讨论发布");
});

test("team identity names the active member and counts parallel members", async ({
  service,
  page,
}, info) => {
  const rpc = async (method: string, json: object = {}) =>
    (
      await (
        await page.request.post(`${service.url}/rpc/${method}`, {
          data: { json },
        })
      ).json()
    ).json;
  const owner = (await rpc("bots/list"))[0];
  const reviewer = await rpc("bots/create", {
    name: "Reviewer",
    requestId: crypto.randomUUID(),
  });
  const teamId = crypto.randomUUID();
  await rpc("teams/create", {
    id: teamId,
    name: "发布小队",
    purpose: "检查发布",
    owner: owner.id,
    members: [owner.id, reviewer.id],
  });
  const snapshot = await rpc("teams/get", { id: teamId });
  await page.addInitScript((initial) => {
    const fetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const input = args[0];
      const address = input instanceof Request ? input.url : String(input);
      if (!address.endsWith("/rpc/teams/changes")) return fetch(...args);
      return new Response(
        new ReadableStream({
          start(controller) {
            const deliver = (view: unknown) =>
              controller.enqueue(
                new TextEncoder().encode(
                  `event: message\ndata: ${JSON.stringify({ json: { type: "snapshot", view } })}\n\n`,
                ),
              );
            Reflect.set(window, "deliverTeamActivity", deliver);
            deliver(initial);
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    };
  }, snapshot);
  await page.goto(service.url);
  await page.getByRole("link", { name: "发布小队", exact: false }).click();
  await page.waitForFunction(
    () => typeof Reflect.get(window, "deliverTeamActivity") === "function",
  );
  const header = page.locator(".chat-identity");
  const status = header.locator(".chat-identity-status");
  await expect(status).toBeEmpty();
  const width = (await header.locator(".chat-identity-label").boundingBox())
    ?.width;
  const state = {
    ...snapshot,
    busy: true,
    activity: [
      {
        botId: reviewer.id,
        sessionId: 101,
        executionId: "review",
        processing: true,
        author: {
          botId: reviewer.id,
          name: reviewer.name,
          avatar: reviewer.avatar,
        },
      },
    ],
    runs: [],
    messages: [
      {
        id: "call",
        turnId: "review",
        sessionId: 101,
        role: "assistant",
        stopped: false,
        content: [
          {
            type: "toolCall",
            id: "read",
            key: "read",
            name: "read",
            arguments: {},
          },
        ],
      },
    ],
  };
  const deliver = () =>
    page.evaluate(
      (state) => Reflect.get(window, "deliverTeamActivity")(state),
      state,
    );
  await deliver();
  await expect(status).toHaveText("Reviewer 正在读取文件");
  expect(
    (await header.locator(".chat-identity-label").boundingBox())?.width,
  ).toBe(width);
  await expect(status).toHaveAttribute("title", "Reviewer 正在读取文件");
  expect(
    await status.evaluate((node) => node.scrollWidth > node.clientWidth),
  ).toBe(true);
  await expect(header.locator('.character[data-work="working"]')).toHaveCount(
    1,
  );
  state.activity.push({
    botId: owner.id,
    sessionId: 102,
    executionId: "write",
    processing: true,
    author: { botId: owner.id, name: owner.name, avatar: owner.avatar },
  });
  await deliver();
  await expect(status).toHaveText("2 位成员正在工作");
  await expect(header.locator('.character[data-work="working"]')).toHaveCount(
    2,
  );
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await header.screenshot({
      path: info.outputPath(`team-working-${theme}.png`),
    });
  }
  state.activity = [
    { ...state.activity[0], waiting: "等待你的回答。", processing: false },
    state.activity[1],
  ];
  await deliver();
  await expect(status).toHaveText("Reviewer 等你回答");
  await expect(header.locator('.character[data-work="working"]')).toHaveCount(
    1,
  );
  state.activity = state.activity.slice(0, 1);
  await deliver();
  await expect(status).toHaveText("Reviewer 等你回答");
  await expect(header.locator('.character[data-work="working"]')).toHaveCount(
    0,
  );
  await expect(header.locator('.character[data-work="waiting"]')).toHaveCount(
    1,
  );
  state.busy = false;
  state.activity = [];
  await deliver();
  await expect(status).toBeEmpty();
  await expect(header.locator(".character[data-work]")).toHaveCount(0);
});
