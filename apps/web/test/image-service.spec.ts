import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { expect } from "@playwright/test";
import type { client as appClient } from "../src/client.ts";
import { test } from "./fixtures/service.ts";

const sharp = createRequire(
  new URL("../../../packages/agent/package.json", import.meta.url),
)("sharp");

test("image service generates media and shared tools apply a character with work equipment", async ({
  page,
  service,
}) => {
  test.setTimeout(120000);
  const calls: Record<string, unknown>[] = [];
  const provider = createServer(async (request, response) => {
    if (request.url === "/v1/models") {
      response.end(JSON.stringify({ data: [{ id: "gpt-image-2.6-flare" }] }));
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    calls.push(body);
    const frames = body.output_format === "gif" ? 9 : 1;
    const data = Buffer.alloc(24 * 24 * frames * 4);
    for (let f = 0; f < frames; f++)
      for (let y = 0; y < 24; y++)
        for (let x = 0; x < 24; x++)
          data.set(
            x >= 6 + (f % 2) && x < 18 + (f % 2) && y >= 6 && y < 18
              ? [240, 200, f % 2 ? 50 : 0, 255]
              : [0, 0, 255, 255],
            ((f * 24 + y) * 24 + x) * 4,
          );
    const image = sharp(data, {
      raw: { width: 24, height: 24 * frames, channels: 4, pageHeight: 24 },
    });
    const bytes = await (frames > 1
      ? image.gif({
          loop: 0,
          delay: Array(frames).fill(250),
        })
      : image.png()
    ).toBuffer();
    response.end(
      JSON.stringify({ data: [{ b64_json: bytes.toString("base64") }] }),
    );
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const address = provider.address();
  if (!address || typeof address === "string")
    throw new Error("provider address");
  try {
    const api = createORPCClient<typeof appClient>(
      new RPCLink({ url: `${service.url}/rpc` }),
    );
    const bots = await api.bots.list();
    const botId = bots[0]?.id;
    if (!botId) throw new Error("Test Bot missing");
    await page.goto(service.url);
    await page.getByRole("button", { name: "用户菜单", exact: true }).click();
    await page.getByRole("menuitem", { name: "设置", exact: true }).click();
    const settings = page.getByRole("main", { name: "设置", exact: true });
    await settings.getByRole("tab", { name: "AI 服务", exact: true }).click();
    await settings
      .getByRole("button", { name: "设置图像生成", exact: true })
      .click();
    await settings
      .getByRole("textbox", { name: "图像服务 Base URL", exact: true })
      .fill(`http://127.0.0.1:${address.port}/v1`);
    await settings
      .getByLabel("图像服务 API Key", { exact: true })
      .fill("test-only-key");
    await settings
      .getByRole("button", { name: "保存图像服务", exact: true })
      .click();
    await expect(
      settings.getByText("已配置；留空保留原密钥。", { exact: true }),
    ).toBeVisible();
    await expect(
      settings.getByLabel("图像服务 API Key", { exact: true }),
    ).toHaveValue("");
    await settings
      .getByRole("button", { name: "检查连接", exact: true })
      .click();
    await expect(
      settings.getByText(/连接可用：.*GIF 尚需试生成验证/),
    ).toBeVisible();
    expect(calls).toHaveLength(0);
    await settings
      .getByRole("button", { name: "试生成动图", exact: true })
      .click();
    await expect(
      settings.getByText("试生成完成。", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expect(settings.locator(".image-thumbnail img")).toBeVisible();
    await page.screenshot({ path: "test-results/image-service-settings.png" });
    await page.getByRole("button", { name: "关闭设置", exact: true }).click();
    await service.control({
      responses: [
        {
          content: [
            {
              type: "toolCall",
              id: "generate-media",
              name: "image_generate",
              arguments: {
                prompt: "A waving dinosaur",
                purpose: "avatar",
                frames: 2,
                frameDurationMs: 100,
              },
            },
          ],
          stopReason: "toolUse",
        },
        { content: "动图已经生成。" },
      ],
    });
    const composer = page.getByRole("textbox", { name: "消息", exact: true });
    await composer.fill("用这个挥手角色作为头像");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(
      page.locator(".messages").getByText("动图已经生成。", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    const animation = page.locator(".messages .image-thumbnail img").first();
    await expect(animation).toBeVisible();
    const first = createHash("sha256")
      .update(await animation.screenshot())
      .digest("hex");
    await expect
      .poll(
        async () =>
          createHash("sha256")
            .update(await animation.screenshot())
            .digest("hex"),
        { timeout: 4000, intervals: [70, 110, 130] },
      )
      .not.toBe(first);
    await service.control({
      responses: [
        {
          content: [
            {
              type: "toolCall",
              id: "apply-avatar",
              name: "bot_update",
              arguments: {
                name: "小怪兽",
                avatarFileId: (await animation.getAttribute("src"))
                  ?.split("/")
                  .pop(),
              },
            },
          ],
          stopReason: "toolUse",
        },
        { content: "角色已应用。" },
      ],
    });
    await composer.fill("把刚才的角色设为你的头像，名字叫小怪兽");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(
      page.locator(".messages").getByText("角色已应用。", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    const applied = await api.work.profile({ botId });
    const character = page.locator(".chat-header .character").first();
    await expect(character.locator(".character-body > image")).toHaveAttribute(
      "href",
      applied.avatarMedia?.src ?? "",
    );
    await expect(character.locator(".character-face")).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(character.locator(".character-body > image")).toHaveAttribute(
      "href",
      applied.avatarMedia?.cover ?? "",
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.screenshot({ path: "test-results/image-character-applied.png" });
    await page.getByRole("button", { name: "Bot详情", exact: true }).click();
    const details = page.locator("#bot-details");
    await details.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(
      details.getByText("角色装备预览", { exact: true }),
    ).toBeVisible();
    await expect(details.locator(".character-work-headset")).toBeVisible();
    await page.screenshot({
      path: "test-results/image-character-equipment.png",
    });
    await details
      .getByRole("button", { name: "恢复内置角色", exact: true })
      .click();
    await expect
      .poll(async () => (await api.work.profile({ botId })).avatarMedia)
      .toBeUndefined();
    expect((await api.images.state({ botId })).configured).toBe(true);
  } finally {
    provider.closeAllConnections();
    provider.close();
  }
});
