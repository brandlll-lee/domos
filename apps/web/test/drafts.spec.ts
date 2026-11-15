import { expect } from "@playwright/test";
import { png } from "../../../packages/agent/test/fixtures/png.ts";
import { attachFiles, createBot } from "./fixtures/chat-ui.ts";
import { test } from "./fixtures/service.ts";

test("drafts survive reload and reopening in the same browser", async ({
  service,
  page,
  context,
}) => {
  await page.goto(service.url);
  const input = page.getByLabel("消息", { exact: true });
  await input.fill("尚未发送的想法");
  await page.reload();
  await expect(input).toHaveText("尚未发送的想法");
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(service.url);
  await expect(reopened.getByLabel("消息", { exact: true })).toHaveText(
    "尚未发送的想法",
  );
  await expect(reopened.getByLabel("你的消息")).toHaveCount(0);
});

test("drafts stay on their computer when the same address changes hosts", async ({
  service,
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "domos:composer:v1:1",
      JSON.stringify({ text: "原有草稿", attachments: [], pending: null }),
    );
  });
  await page.goto(service.url);
  const input = page.getByLabel("消息", { exact: true });
  await expect(input).toHaveText("原有草稿");
  await input.fill("ASUS 草稿");
  await page.route("**/rpc/computer/node", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.json.id = "another-computer";
    await route.fulfill({ response, json: body });
  });
  await page.reload();
  await expect(input).toHaveText("");
  await input.fill("云电脑草稿");
  await page.unroute("**/rpc/computer/node");
  await page.reload();
  await expect(input).toHaveText("ASUS 草稿");
});

test("editing during a send preserves the next draft", async ({
  service,
  page,
}) => {
  await page.goto(service.url);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  const receipt = Promise.withResolvers<void>();
  const sent = Promise.withResolvers<void>();
  await page.route("**/rpc/send", async (route) => {
    const response = await route.fetch();
    sent.resolve();
    await receipt.promise;
    await route.fulfill({ response });
  });
  const input = page.getByLabel("消息", { exact: true });
  await input.fill("第一条消息");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await sent.promise;
  await input.pressSequentially("下一条草稿");
  receipt.resolve();
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeVisible();
  await expect(input).toHaveText("下一条草稿");
  await page.reload();
  await expect(input).toHaveText("下一条草稿");
});

test("storage failures keep the draft and prevent an unrecorded send", async ({
  service,
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Blocked", "SecurityError");
    };
  });
  await page.goto(service.url);
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  const input = page.getByLabel("消息", { exact: true });
  await input.fill("保留在输入框");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "草稿保存失败" }),
  ).toBeVisible();
  await expect(input).toHaveText("保留在输入框");
  await expect(page.getByLabel("你的消息")).toHaveCount(0);
});

test("attachment retry keeps its request and draft after a lost receipt", async ({
  service,
  page,
}) => {
  await page.goto(service.url);
  const input = page.getByLabel("消息", { exact: true });
  await expect(
    page.getByRole("button", { name: "添加内容", exact: true }),
  ).toBeEnabled();
  await attachFiles(page, {
    name: "source.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Source"),
  });
  await expect(
    page.getByRole("button", { name: "移除文件 source.txt", exact: true }),
  ).toBeEnabled();
  await input.fill("处理文件");
  let lost = false;
  await page.route("**/rpc/send", async (route) => {
    if (lost) return route.continue();
    lost = true;
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重试发送", exact: true }),
  ).toBeEnabled();
  await page.reload();
  const retry = page.getByRole("button", { name: "重试发送", exact: true });
  await expect(retry).toBeEnabled();
  await expect(page.locator(".composer-attachments")).toHaveCount(0);
  await retry.click();
  await expect(
    page.getByRole("button", { name: "语音输入（暂未开放）", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("你的消息", { exact: true })).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "另存为 source.txt", exact: true }),
  ).toHaveCount(1);
  await expect(page.locator(".composer-attachments")).toHaveCount(0);
});

for (const method of ["click", "Enter"] as const) {
  test(`sending attachments clears the editor before the receipt via ${method}`, async ({
    service,
    page,
  }) => {
    await page.goto(service.url);
    await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
    await attachFiles(page, [
      {
        name: "source.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Source"),
      },
      { name: "image.png", mimeType: "image/png", buffer: png(1, 1) },
    ]);
    await expect(
      page.getByRole("button", { name: "移除文件 source.txt" }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "移除文件 image.png" }),
    ).toBeEnabled();
    const receipt = Promise.withResolvers<void>();
    await page.route("**/rpc/send", async (route) => {
      await receipt.promise;
      await route.continue();
    });
    const input = page.getByLabel("消息", { exact: true });
    if (method === "click") await input.fill("处理附件");
    try {
      if (method === "click")
        await page.getByRole("button", { name: "发送", exact: true }).click();
      else await input.press("Enter");
      await expect(input).toHaveText("");
      const outgoing = page.getByLabel("你的消息", { exact: true });
      await expect(
        outgoing.getByRole("button", {
          name: "另存为 source.txt",
          exact: true,
        }),
      ).toBeVisible();
      await expect(outgoing.locator("img")).toHaveJSProperty("naturalWidth", 1);
      await expect(page.locator(".composer-attachments")).toHaveCount(0);
      await expect(page.locator(".typing-dots")).toBeVisible();
      await input.fill("下一条草稿");
    } finally {
      receipt.resolve();
    }
    await expect(
      page.getByRole("button", { name: "发送", exact: true }),
    ).toBeVisible();
    await expect(input).toHaveText("下一条草稿");
    await page.reload();
    await expect(input).toHaveText("下一条草稿");
    await expect(page.locator(".composer-attachments")).toHaveCount(0);
  });
}

test("a send receipt preserves the draft after switching away and back", async ({
  service,
  page,
}) => {
  await page.goto(service.url);
  await createBot(page, "其他助手");
  await page.getByRole("link", { name: "Domos", exact: true }).click();
  await attachFiles(page, {
    name: "source.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Source"),
  });
  await expect(
    page.getByRole("button", { name: "移除文件 source.txt" }),
  ).toBeEnabled();
  const receipt = Promise.withResolvers<void>();
  await page.route("**/rpc/send", async (route) => {
    await receipt.promise;
    await route.continue();
  });
  const input = page.getByLabel("消息", { exact: true });
  try {
    await input.fill("处理文件");
    await input.press("Enter");
    await expect(
      page.getByRole("button", { name: "发送中…", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "其他助手", exact: true }).click();
    await expect(page.locator(".chat-identity-label")).toHaveText("其他助手");
    await input.fill("其他机器人的草稿");
    await page.getByRole("link", { name: "Domos", exact: true }).click();
    await expect(page.locator(".chat-identity-label")).toHaveText("Domos");
    await input.fill("下一条草稿");
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    receipt.resolve();
  }
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".composer-attachments")).toHaveCount(0);
  await expect(input).toHaveText("下一条草稿");
  await page.reload();
  await expect(input).toHaveText("下一条草稿");
  await page.getByRole("link", { name: "其他助手", exact: true }).click();
  await expect(input).toHaveText("其他机器人的草稿");
});

for (const nextDraft of ["", "下一条草稿"]) {
  test(`a rejected attachment send restores the editor with next draft '${nextDraft}'`, async ({
    service,
    page,
  }) => {
    await page.goto(service.url);
    await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
    await attachFiles(page, {
      name: "source.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Source"),
    });
    await expect(
      page.getByRole("button", { name: "移除文件 source.txt" }),
    ).toBeEnabled();
    const receipt = Promise.withResolvers<void>();
    await page.route("**/rpc/send", async (route) => {
      await receipt.promise;
      await route.fulfill({
        status: 409,
        json: {
          json: { code: "CONFLICT", message: "任务未接收", status: 409 },
        },
      });
    });
    const input = page.getByLabel("消息", { exact: true });
    try {
      await input.fill("处理文件");
      await input.press("Enter");
      await expect(page.locator(".composer-attachments")).toHaveCount(0);
      await input.fill(nextDraft);
    } finally {
      receipt.resolve();
    }
    await expect(page.getByRole("alert")).toContainText("会话正在回复");
    await expect(input).toHaveText(nextDraft || "处理文件");
    await expect(
      page.getByRole("button", { name: "移除文件 source.txt" }),
    ).toBeEnabled();
    await expect(page.getByLabel("你的消息", { exact: true })).toHaveCount(0);
  });
}

test("file upload retry keeps its identity and cancellation releases the draft", async ({
  service,
  page,
}) => {
  await page.goto(service.url);
  await expect(
    page.getByRole("button", { name: "添加内容", exact: true }),
  ).toBeEnabled();
  let lost = false;
  await page.route("**/files/*/upload?*", async (route) => {
    if (lost) return route.continue();
    lost = true;
    await route.fetch();
    await route.abort("failed");
  });
  await attachFiles(page, {
    name: "retry.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Draft source"),
  });
  await expect(page.locator(".composer-upload")).toContainText("上传失败");
  await page
    .locator(".composer-upload")
    .getByRole("button", { name: "重试", exact: true })
    .click();
  const remove = page.getByRole("button", {
    name: "移除文件 retry.txt",
    exact: true,
  });
  await expect(remove).toBeVisible();
  await remove.click();
  await expect(page.locator(".composer-attachments")).toHaveCount(0);
  const release = Promise.withResolvers<void>();
  const reached = Promise.withResolvers<void>();
  await page.unroute("**/files/*/upload?*");
  await page.route("**/files/*/upload?*", async (route) => {
    const response = await route.fetch();
    reached.resolve();
    await release.promise;
    await route.fulfill({ response });
  });
  await attachFiles(page, {
    name: "cancel.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Cancelled source"),
  });
  await reached.promise;
  await page
    .getByRole("button", { name: "取消上传 cancel.txt", exact: true })
    .click();
  release.resolve();
  await expect(page.locator(".composer-attachments")).toHaveCount(0);
  await page.getByLabel("消息", { exact: true }).fill("A regular message");
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeEnabled();
});
