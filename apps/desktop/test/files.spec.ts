import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { pdf } from "../../../packages/agent/test/fixtures/pdf.ts";

test("desktop uploads, previews, searches and downloads saved files", async ({
  playwright,
}, testInfo) => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), "domos-desktop-files-"));
  const worker = fork(
    fileURLToPath(
      new URL("../../api/test/fixtures/web-server.ts", import.meta.url),
    ),
    [join(directory, "agent.sqlite"), "0", "hosting"],
    { silent: true, execArgv: [] },
  );
  worker.stdout?.resume();
  worker.stderr?.resume();
  const [ready] = (await once(worker, "message")) as [
    { port: number; pairing: string },
  ];
  const executablePath = createRequire(
    new URL("../package.json", import.meta.url),
  )("electron") as string;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.PATH = directory;
  const profile = join(directory, "profile");
  await mkdir(profile);
  const desktop = await playwright._electron.launch({
    executablePath,
    args: [
      fileURLToPath(new URL("./entry.mjs", import.meta.url)),
      `--test-data-dir=${profile}`,
    ],
    env,
  });
  try {
    const setup = await desktop.firstWindow();
    await setup
      .getByRole("button", { name: "连接另一台电脑", exact: true })
      .click();
    await setup.getByLabel("Domos 地址").fill(`http://127.0.0.1:${ready.port}`);
    const opened = desktop.waitForEvent("window");
    await setup.getByRole("button", { name: "连接", exact: true }).click();
    const page = await opened;
    await page.getByLabel("配对码", { exact: true }).fill(ready.pairing);
    await page.getByRole("button", { name: "连接", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Bot详情", exact: true }),
    ).toBeVisible();
    await page
      .locator("#bot-details")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page.getByRole("button", { name: "添加内容", exact: true }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: "添加文件", exact: true }).click();
    await (await chooser).setFiles([
      { name: "阅读.pdf", mimeType: "application/pdf", buffer: pdf() },
      {
        name: "说明.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("# 桌面文件预览\n\n**中文内容**"),
      },
      {
        name: "数据.csv",
        mimeType: "text/csv",
        buffer: Buffer.from('name,value\n"a,b",001'),
      },
      {
        name: "交互.html",
        mimeType: "text/html",
        buffer: Buffer.from(
          "<button onclick=\"this.textContent='已计算'\">计算</button>",
        ),
      },
    ]);
    await expect(page.locator(".composer-attachments .attachment")).toHaveCount(
      4,
    );
    await page
      .getByRole("textbox", { name: "消息", exact: true })
      .fill("桌面验收");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    const panel = page.getByRole("complementary", {
      name: "文件预览",
      exact: true,
    });
    for (const [name, text] of [
      ["阅读.pdf", "PDF page one"],
      ["说明.md", "桌面文件预览"],
      ["数据.csv", "001"],
    ]) {
      await page
        .getByRole("button", { name: `预览 ${name}`, exact: true })
        .click();
      await expect(panel).toContainText(text ?? "");
      if (name === "阅读.pdf") {
        await expect(panel.locator("canvas").first()).toBeVisible();
        const path = join(directory, "download.pdf");
        const download = desktop.evaluate(
          ({ BrowserWindow }, path) =>
            new Promise<string>((resolve) => {
              BrowserWindow.getAllWindows()
                .find((window) =>
                  window.webContents.getURL().startsWith("http"),
                )
                ?.webContents.session.once("will-download", (_event, item) => {
                  item.setSavePath(path);
                  item.once("done", (_event, state) => resolve(state));
                });
            }),
          path,
        );
        await panel
          .getByRole("button", { name: "下载文件", exact: true })
          .click();
        expect(await download).toBe("completed");
        expect(await readFile(path)).toEqual(pdf());
        await page.screenshot({
          path: testInfo.outputPath("desktop-files-light.png"),
        });
      }
      await panel.getByRole("button", { name: "关闭", exact: true }).click();
    }
    await page
      .getByRole("button", { name: "预览 交互.html", exact: true })
      .click();
    const content = panel.frameLocator("iframe").frameLocator("iframe");
    await content.getByRole("button", { name: "计算", exact: true }).click();
    await expect(
      content.getByRole("button", { name: "已计算", exact: true }),
    ).toBeVisible();
    expect(
      await content
        .locator("body")
        .evaluate(() => typeof Reflect.get(window, "domosDesktop")),
    ).toBe("undefined");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(content.locator("body")).toHaveCSS(
      "background-color",
      "rgb(12, 12, 13)",
    );
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(480, 720),
    );
    await expect(panel).toBeInViewport();
    expect(
      (await panel.locator("iframe").boundingBox())?.height,
    ).toBeGreaterThan(400);
    expect(
      await panel.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("desktop-files-dark-narrow.png"),
    });
    await panel.getByRole("button", { name: "返回", exact: true }).click();
    await page
      .getByRole("searchbox", { name: "搜索文件", exact: true })
      .fill("说明");
    await expect(page.locator(".file-list-row")).toHaveCount(1);
    await page
      .getByRole("button", { name: "在聊天中查看", exact: true })
      .click();
    await expect(
      page
        .getByRole("log", { name: "聊天记录", exact: true })
        .getByRole("button", { name: "预览 说明.md", exact: true }),
    ).toBeInViewport();
  } finally {
    await desktop.close();
    const exited = once(worker, "exit");
    worker.kill("SIGKILL");
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});
