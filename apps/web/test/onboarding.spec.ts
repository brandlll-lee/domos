import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

test("onboarding preserves drafts and requests computer authorization only when needed", async ({
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
    await expect(page.getByRole("button", { name: "Bot详情" })).toBeVisible();
    await page.getByRole("button", { name: "新建 Bot" }).first().click();
    await page
      .getByRole("textbox", { name: "名字", exact: true })
      .fill("Writer");
    await page.getByRole("button", { name: "创建", exact: true }).click();
    await expect(page.getByRole("button", { name: "Bot详情" })).toContainText(
      "Writer",
    );
    await page.getByRole("button", { name: "Bot详情" }).click();
    const details = page.getByRole("complementary", { name: "Writer的详情" });
    await details.getByRole("combobox", { name: "Bot设置分区" }).click();
    await page.getByRole("option", { name: "电脑", exact: true }).click();
    await expect(details.getByLabel("分配电脑")).toHaveValue("");
    await details.getByRole("button", { name: "关闭", exact: true }).click();
    await page
      .getByRole("textbox", { name: "消息", exact: true })
      .fill("保留这份草稿");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    const settings = page.getByRole("dialog", {
      name: "设置",
      exact: true,
    });
    await expect(settings).toBeVisible();
    await expect(
      settings.getByRole("heading", { name: "连接模型" }),
    ).toBeVisible();
    await settings.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toHaveValue("保留这份草稿");
    await page.getByRole("button", { name: "Bot详情" }).click();
    await details
      .getByRole("button", { name: "连接模型", exact: true })
      .click();
    await settings
      .getByLabel("此 Bot 的模型")
      .selectOption({ label: "Faux Model" });
    await settings
      .getByRole("button", { name: "保存模型", exact: true })
      .click();
    await expect(settings).toBeHidden();
    await expect(page.getByText("模型已回复。", { exact: true })).toHaveCount(
      0,
    );
    await details.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(
      page
        .getByRole("log", { name: "聊天记录" })
        .getByText("模型已回复。", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "添加文件", exact: true }).click();
    await expect(details.getByLabel("分配电脑")).toBeVisible();
    await details
      .getByRole("button", { name: "管理电脑", exact: true })
      .click();
    await settings.getByText("授权使用本机", { exact: true }).click();
    await page
      .getByRole("dialog", { name: "授权使用本机", exact: true })
      .getByRole("button", { name: "确认授权", exact: true })
      .click();
    await expect(settings.getByText(/已授权/)).toBeVisible();
    await settings.getByRole("button", { name: "关闭", exact: true }).click();
    await details.getByLabel("分配电脑").selectOption("process");
    await expect(
      details.getByText(
        "工具使用服务进程的系统权限。工作目录不是安全隔离边界。",
        { exact: true },
      ),
    ).toBeVisible();
    await details.getByRole("button", { name: "关闭", exact: true }).click();

    await page
      .locator('input[type="file"][aria-label="添加文件"]')
      .setInputFiles({
        name: "input.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("source"),
      });
    await expect(page.getByText("input.txt", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Bot详情" })).toContainText(
      "Writer",
    );
    await page.screenshot({ path: testInfo.outputPath("onboarding.png") });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await expect(settings).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    const exited = once(worker, "exit");
    worker.disconnect();
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});
