import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

test("native account flows show login choices, retain providers, and select models directly", async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "domos-engine-accounts-"));
  const worker = fork(
    fileURLToPath(
      new URL("../../api/test/fixtures/onboarding-server.ts", import.meta.url),
    ),
    [join(directory, "data"), "accounts"],
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
    await page.getByRole("button", { name: "授权并继续", exact: true }).click();
    const engines = page.getByRole("radiogroup", {
      name: "任务引擎",
      exact: true,
    });
    await engines.getByRole("radio", { name: /^Claude Code/ }).click();
    await page.getByRole("button", { name: "连接账号", exact: true }).click();
    const claude = page.getByRole("dialog", {
      name: "连接 Claude Code",
      exact: true,
    });
    await expect(
      claude.getByRole("button", { name: "完成", exact: true }),
    ).toHaveCount(0);
    await expect(claude.locator(".brand-mark")).toBeVisible();
    await claude
      .getByRole("button", { name: "使用 API 密钥", exact: true })
      .click();
    await expect(
      claude.getByLabel("Anthropic API 密钥", { exact: true }),
    ).toHaveAttribute("type", "password");
    await claude.getByRole("button", { name: "账号登录", exact: true }).click();
    await claude
      .getByRole("button", { name: "登录 Claude", exact: true })
      .click();
    await expect(
      claude.getByRole("link", { name: "打开登录页面" }),
    ).toHaveAttribute("href", /^https:\/\/claude\.com\//);
    await claude.getByRole("button", { name: "关闭弹窗", exact: true }).click();
    await expect(claude).toBeHidden();
    await page.getByRole("button", { name: "连接账号", exact: true }).click();
    await claude
      .getByRole("button", { name: "登录 Claude", exact: true })
      .click();
    await claude
      .getByLabel("粘贴登录页面显示的代码", { exact: true })
      .fill("bad-code");
    await claude.getByRole("button", { name: "继续", exact: true }).click();
    await expect(claude.getByRole("alert")).toContainText("登录未完成");
    await claude
      .getByRole("button", { name: "登录 Claude", exact: true })
      .click();
    await claude
      .getByLabel("粘贴登录页面显示的代码", { exact: true })
      .fill("fixture-code");
    await page.screenshot({
      path: info.outputPath("claude-browser-login.png"),
    });
    await claude.getByRole("button", { name: "继续", exact: true }).click();
    await expect(claude).toBeHidden();
    await expect(
      page.getByRole("button", { name: "开始使用", exact: true }),
    ).toBeEnabled();

    await engines.getByRole("radio", { name: /^OpenCode/ }).click();
    await page.getByRole("button", { name: "连接账号", exact: true }).click();
    const opencode = page.getByRole("dialog", {
      name: "连接 OpenCode",
      exact: true,
    });
    await opencode
      .getByRole("combobox", { name: "模型服务", exact: true })
      .click();
    await page.getByRole("option", { name: "OpenAI", exact: true }).click();
    await expect(
      opencode.getByRole("combobox", { name: "连接方式", exact: true }),
    ).toBeVisible();
    await expect(
      opencode.getByRole("button", { name: "登录 OpenAI", exact: true }),
    ).toBeVisible();
    await opencode
      .getByRole("button", { name: "登录 OpenAI", exact: true })
      .click();
    await expect(
      opencode.getByRole("link", { name: "打开登录页面" }),
    ).toBeVisible();
    await opencode
      .getByLabel("粘贴登录页面显示的代码", { exact: true })
      .fill("fixture-code");
    await opencode.getByRole("button", { name: "继续", exact: true }).click();
    await expect(opencode).toBeHidden();
    const card = page.locator(".engine-connection");
    await expect(
      card.getByRole("button", { name: "选择模型", exact: true }),
    ).toBeVisible();
    await expect(
      card.getByRole("button", { name: "重新检查", exact: true }),
    ).toBeVisible();
    await card.getByRole("button", { name: "选择模型", exact: true }).click();
    const model = page.getByRole("dialog", { name: "选择模型", exact: true });
    await expect(
      model.getByRole("button", { name: "完成", exact: true }),
    ).toHaveCount(0);
    await expect(
      model.getByRole("button", { name: "保存模型", exact: true }),
    ).toHaveCount(0);
    await model
      .getByRole("button", { name: "Fixture OpenCode Model", exact: true })
      .click();
    await expect(model).toBeHidden();

    await card.getByRole("button", { name: "账号设置", exact: true }).click();
    await opencode
      .getByRole("combobox", { name: "模型服务", exact: true })
      .click();
    await page.getByRole("option", { name: "Other", exact: true }).click();
    const key = opencode.getByLabel("Other API 密钥", { exact: true });
    await expect(key).toHaveAttribute("type", "password");
    await key.fill("fixture-key");
    await opencode.getByRole("button", { name: "连接", exact: true }).click();
    await expect(opencode).toBeHidden();
    await card.getByRole("button", { name: "账号设置", exact: true }).click();
    await opencode
      .getByRole("combobox", { name: "模型服务", exact: true })
      .click();
    await expect(
      page.getByRole("option", { name: "OpenAI · 可用", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: "Other · 可用", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("option", { name: "OpenAI · 可用", exact: true })
      .click();
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      for (const [width, height] of [
        [1360, 900],
        [390, 500],
      ] as const) {
        await page.setViewportSize({ width, height });
        await expect(
          opencode.getByRole("button", { name: "关闭弹窗", exact: true }),
        ).toBeInViewport();
        expect((await opencode.boundingBox())?.height).toBeLessThan(height);
        await page.screenshot({
          path: info.outputPath(`account-${colorScheme}-${width}.png`),
        });
      }
    }
    await page.keyboard.press("Escape");
    await expect(opencode).toBeHidden();
    await page.getByRole("button", { name: "开始使用", exact: true }).click();
    await page.getByRole("button", { name: "Bot详情", exact: true }).click();
    const details = page.getByRole("complementary", { name: /的详情$/ });
    await expect(
      details.getByRole("button", { name: /^对话模型\s/ }),
    ).toContainText("openai/one");
    await page.setViewportSize({ width: 1360, height: 900 });
    await details.getByRole("button", { name: /^任务引擎\s/ }).click();
    await details.getByRole("combobox", { name: "任务引擎" }).click();
    await page
      .getByRole("option", { name: "Claude Code", exact: true })
      .click();
    await details
      .getByRole("button", { name: "检查连接", exact: true })
      .click();
    await details
      .getByRole("button", { name: "账号设置", exact: true })
      .click();
    await claude
      .getByRole("button", { name: "登录 Claude", exact: true })
      .click();
    await claude
      .getByLabel("粘贴登录页面显示的代码", { exact: true })
      .fill("fixture-code");
    await claude.getByRole("button", { name: "继续", exact: true }).click();
    await expect(claude).toBeHidden();
    await details
      .getByRole("button", { name: "账号设置", exact: true })
      .click();
    await expect(
      claude.getByRole("button", { name: "登录 Claude", exact: true }),
    ).toBeVisible();
    await claude.getByRole("button", { name: "关闭弹窗", exact: true }).click();
    await details.getByRole("combobox", { name: "任务引擎" }).click();
    await page.getByRole("option", { name: "OpenCode", exact: true }).click();
    await page.route(
      "**/rpc/engines/inspect",
      (route) =>
        route.fulfill({
          json: { json: { ready: false, authenticated: false, models: [] } },
        }),
      { times: 1 },
    );
    await details
      .getByRole("button", { name: "检查连接", exact: true })
      .click();
    await details
      .getByRole("button", { name: "安装 OpenCode", exact: true })
      .click();
    const installation = page.getByRole("dialog", {
      name: "安装 OpenCode",
      exact: true,
    });
    await page.route("**/rpc/engines/install", (route) =>
      route.fulfill({ json: { json: { ok: true } } }),
    );
    await installation
      .getByRole("button", { name: "安装 OpenCode", exact: true })
      .click();
    await expect(installation).toBeHidden();
    await expect(
      details.getByRole("button", { name: "账号设置", exact: true }),
    ).toBeVisible();
  } finally {
    const exited = once(worker, "exit");
    worker.disconnect();
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});
