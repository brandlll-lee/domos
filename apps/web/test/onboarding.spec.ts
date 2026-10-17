import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

test("first use connects a model and authorizes a computer before opening chat", async ({
  page,
}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), "domos-onboarding-web-"));
  const worker = fork(
    fileURLToPath(
      new URL("../../api/test/fixtures/onboarding-server.ts", import.meta.url),
    ),
    [join(directory, "data")],
    { silent: true, execArgv: [] },
  );
  worker.stdout?.resume();
  worker.stderr?.resume();
  try {
    const [ready] = (await once(worker, "message")) as [
      { port: number; code: string },
    ];
    await page.goto(`http://127.0.0.1:${ready.port}`);
    await page.getByLabel("配对码", { exact: true }).fill(ready.code);
    await page.getByRole("button", { name: "连接", exact: true }).click();
    const setup = page.getByRole("main", { name: "首次设置" });
    await expect(
      setup.getByRole("heading", { name: "连接对话模型" }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toBeHidden();
    await setup.getByRole("combobox", { name: "此 Bot 的模型" }).click();
    await page.getByRole("option", { name: "Faux Model", exact: true }).click();
    await setup.getByRole("button", { name: "保存模型", exact: true }).click();
    await expect(
      setup.getByRole("heading", { name: "认识你的第一个 Bot" }),
    ).toBeVisible();
    await setup.getByRole("button", { name: "继续", exact: true }).click();
    const service = setup.getByRole("button", { name: /^使用服务所在电脑/ });
    const title = await service.locator("strong").boundingBox();
    const description = await service.locator("span").boundingBox();
    expect(description?.y).toBeGreaterThan(
      (title?.y ?? 0) + (title?.height ?? 0),
    );
    await page.screenshot({
      path: testInfo.outputPath("work-environment.png"),
    });
    await expect(
      setup.getByRole("heading", { name: "Bot 在哪里工作？" }),
    ).toBeVisible();
    await expect(
      setup.getByRole("button", { name: /^共用一台隔离电脑/ }),
    ).toBeDisabled();
    await page.route("**/rpc/computer/configure", (route) => route.abort());
    await setup
      .getByRole("button", { name: "授权并继续", exact: true })
      .click();
    await expect(setup.getByRole("alert")).toBeVisible();
    await expect(setup).toBeVisible();
    await page.unroute("**/rpc/computer/configure");
    await setup
      .getByRole("button", { name: "授权并继续", exact: true })
      .click();
    await expect(setup).toBeHidden();
    await page
      .getByRole("textbox", { name: "消息", exact: true })
      .fill("确认首次配置成功");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(
      page
        .getByRole("log", { name: "聊天记录" })
        .getByText("模型已回复。", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(setup).toBeHidden();
    await expect(page.getByRole("button", { name: "Bot详情" })).toBeVisible();
    await page.getByRole("button", { name: "Bot电脑", exact: true }).click();
    const computer = page.getByRole("complementary", { name: "Domos的详情" });
    await expect(
      computer.getByText("服务所在电脑", { exact: true }),
    ).toBeVisible();
    await expect(
      computer.getByText("✓ 可执行命令", { exact: true }),
    ).toBeVisible();
    await expect(
      computer.getByText("✓ 可处理文件", { exact: true }),
    ).toBeVisible();
    await computer.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const settings = page.getByRole("main", { name: "设置", exact: true });
    await expect(settings.getByRole("tab")).toHaveText(["通用", "模型"]);
    await settings
      .getByRole("button", { name: "连接设备", exact: true })
      .click();
    const access = page.getByRole("dialog", {
      name: "在其他设备上使用",
      exact: true,
    });
    await expect(
      access.getByRole("heading", { name: "已授权访问", exact: true }),
    ).toBeVisible();
    await access
      .getByRole("button", { name: "生成配对码", exact: true })
      .click();
    await expect(access.locator(".pairing-code")).not.toBeEmpty();
    await access.getByRole("button", { name: "完成", exact: true }).click();
    await expect(access).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath("configured.png") });
  } finally {
    const exited = once(worker, "exit");
    worker.disconnect();
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});
