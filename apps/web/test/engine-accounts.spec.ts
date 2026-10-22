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
  test.setTimeout(90_000);
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
  const launches = async () => {
    const response = once(worker, "message");
    worker.send("launches");
    return ((await response)[0] as { launches: number }).launches;
  };
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
      .getByRole("button", { name: "添加提供方", exact: true })
      .click();
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
      .getByRole("button", { name: "添加提供方", exact: true })
      .click();
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
      .getByRole("button", { name: "添加提供方", exact: true })
      .click();
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
    await expect(
      page.getByRole("button", { name: "选择引擎与模型", exact: true }),
    ).toContainText("openai/one");
    await page.setViewportSize({ width: 1360, height: 900 });
    const trigger = page.getByRole("button", {
      name: "选择引擎与模型",
      exact: true,
    });
    await trigger.click();
    const selector = page.getByRole("dialog", {
      name: "任务引擎与模型",
      exact: true,
    });
    await expect(selector.getByRole("tab")).toHaveCount(4);
    await expect(trigger).toContainText("Fixture OpenCode Model");
    let configurations = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/rpc/engines/configure")) configurations++;
    });
    await selector.getByRole("tab", { name: "Pi", exact: true }).click();
    await expect(trigger).toContainText("Fixture OpenCode Model");
    await expect(
      selector.getByRole("button", { name: "Faux Model", exact: true }),
    ).toBeVisible();
    expect(configurations).toBe(0);
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(trigger).toContainText("openai/one");
    await trigger.click();
    await selector
      .getByRole("button", { name: "Other Model", exact: true })
      .click();
    await expect(selector).toBeHidden();
    await expect(trigger).toContainText("Other Model");
    await page.reload();
    await expect(trigger).toContainText("other/two");
    await trigger.click();
    await selector
      .getByRole("button", { name: "Fixture OpenCode Model", exact: true })
      .click();
    await expect(selector).toBeHidden();
    await trigger.click();
    await expect(
      selector.getByRole("button", { name: "管理连接与账号", exact: true }),
    ).toHaveCount(0);
    await selector
      .getByRole("button", { name: "连接与账号设置", exact: true })
      .click();
    const settings = page.getByRole("dialog", { name: "设置", exact: true });
    const beforeAccounts = configurations;
    await expect(settings).toBeVisible();
    await expect(
      settings.getByRole("tab", { name: "Providers", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await settings
      .getByRole("tab", { name: "Claude Code", exact: true })
      .click();
    await expect(
      settings.getByRole("region", { name: "Claude Code 连接", exact: true }),
    ).toContainText("已连接");
    await settings.getByRole("tab", { name: "OpenCode", exact: true }).click();
    await settings
      .getByRole("button", { name: "添加提供方", exact: true })
      .click();
    await settings
      .getByRole("combobox", { name: "模型服务", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Other · 可用", exact: true })
      .click();
    await expect(
      settings.getByLabel("Other API 密钥", { exact: true }),
    ).toBeVisible();
    const beforeModels = await launches();
    await settings.getByRole("tab", { name: "Models", exact: true }).click();
    const modelVisibility = settings.getByRole("switch", {
      name: "OpenCode · Other Model",
      exact: true,
    });
    await expect(modelVisibility).toBeChecked();
    expect(await launches()).toBe(beforeModels);
    await modelVisibility.click();
    await expect(modelVisibility).not.toBeChecked();
    expect(configurations).toBe(beforeAccounts);
    await settings
      .getByRole("button", { name: "关闭设置", exact: true })
      .click();
    await expect(trigger).toContainText("Fixture OpenCode Model");
    await trigger.click();
    await expect(
      selector.getByRole("button", { name: "Other Model", exact: true }),
    ).toHaveCount(0);
    await selector.getByRole("tab", { name: "Codex", exact: true }).click();
    await expect(trigger).toContainText("Fixture OpenCode Model");
    await selector
      .getByRole("button", { name: "Test Model", exact: true })
      .click();
    await expect(selector).toBeHidden();
    await trigger.click();
    const effort = selector.getByRole("slider", {
      name: "推理强度",
      exact: true,
    });
    await expect(effort).toHaveAttribute("aria-valuetext", "Medium");
    await expect(selector.getByText("推荐", { exact: true })).toBeVisible();
    const beforeEffort = await launches();
    await effort.focus();
    await effort.press("ArrowRight");
    await expect(effort).toHaveAttribute("aria-valuetext", "High");
    await expect(effort).toBeEnabled();
    expect(await launches()).toBe(beforeEffort);
    const beforeReopen = await launches();
    for (let index = 0; index < 3; index++) {
      await page.keyboard.press("Escape");
      await trigger.click();
      await expect(effort).toHaveAttribute("aria-valuetext", "High");
    }
    expect(await launches()).toBe(beforeReopen);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.screenshot({
        path: info.outputPath(`effort-${colorScheme}.png`),
      });
    }
    await page.keyboard.press("Escape");
    await page.reload();
    await trigger.click();
    await expect(effort).toHaveAttribute("aria-valuetext", "High");
    await selector
      .getByRole("button", { name: "连接与账号设置", exact: true })
      .click();
    await settings.getByRole("tab", { name: "Models", exact: true }).click();
    await expect(modelVisibility).not.toBeChecked();
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      for (const [width, height] of [
        [1360, 768],
        [390, 500],
      ] as const) {
        await page.setViewportSize({ width, height });
        await expect(
          settings.getByLabel("搜索模型", { exact: true }),
        ).toBeInViewport();
        await page.screenshot({
          path: info.outputPath(`models-${colorScheme}-${width}.png`),
        });
      }
    }
    await settings
      .getByRole("button", { name: "关闭设置", exact: true })
      .click();
    await page.setViewportSize({ width: 1360, height: 768 });
    await page
      .getByRole("textbox", { name: "消息", exact: true })
      .fill("Hold this task");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "允许这次操作？", exact: true }),
    ).toBeVisible();
    await trigger.click();
    await selector.getByRole("tab", { name: "OpenCode", exact: true }).click();
    await expect(
      selector.getByRole("button", {
        name: "Fixture OpenCode Model",
        exact: true,
      }),
    ).toBeDisabled();
    await selector
      .getByRole("button", { name: "连接与账号设置", exact: true })
      .click();
    await settings.getByRole("tab", { name: "OpenCode", exact: true }).click();
    await settings
      .getByRole("button", { name: "添加提供方", exact: true })
      .click();
    await settings
      .getByRole("combobox", { name: "模型服务", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Third Service", exact: true })
      .click();
    await settings
      .getByLabel("Third Service API 密钥", { exact: true })
      .fill("fixture-third-key");
    await settings.getByRole("button", { name: "连接", exact: true }).click();
    await expect(settings.getByRole("status")).toContainText(
      "Third Service 已连接",
    );
    await expect(
      settings.getByRole("combobox", { name: "模型服务", exact: true }),
    ).toContainText("Third Service");
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      for (const [width, height] of [
        [1360, 768],
        [390, 500],
      ] as const) {
        await page.setViewportSize({ width, height });
        await settings.getByRole("tab", { name: "Pi", exact: true }).click();
        await expect(
          settings.getByRole("button", { name: "添加提供方", exact: true }),
        ).toBeInViewport();
        await page.screenshot({
          path: info.outputPath(`providers-${colorScheme}-${width}.png`),
        });
      }
    }
    await settings
      .getByRole("button", { name: "关闭设置", exact: true })
      .click();
    await page.setViewportSize({ width: 1360, height: 900 });
    await expect(trigger).toContainText("Test Model");
    await page
      .getByRole("button", { name: "允许这次操作", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "允许这次操作？", exact: true }),
    ).toBeHidden();
    await trigger.click();
    await selector.getByRole("tab", { name: "Pi", exact: true }).click();
    await selector
      .getByRole("button", { name: "Faux Model", exact: true })
      .click();
    await expect(trigger).toContainText("Faux Model");
    await page.reload();
    await expect(trigger).toContainText("Faux Model");
    await page.getByRole("button", { name: "Bot详情", exact: true }).click();
    const details = page.getByRole("complementary", { name: /的详情$/ });
    await details.getByRole("button", { name: /^连接与账号(?:\s|$)/ }).click();
    const source = details.getByRole("combobox", {
      name: "账号来源",
      exact: true,
    });
    await source.click();
    await page
      .getByRole("option", { name: "工作电脑已有配置", exact: true })
      .click();
    await expect(source).toContainText("工作电脑已有配置");
    await details
      .getByRole("button", { name: "选择模型", exact: true })
      .click();
    const nativeModel = page.getByRole("dialog", {
      name: "连接模型",
      exact: true,
    });
    await expect(nativeModel.getByLabel("API 密钥")).toHaveCount(0);
    await nativeModel
      .getByRole("button", { name: "Faux Model 2", exact: true })
      .click();
    await expect(nativeModel).toBeHidden();
    await page.reload();
    await expect(trigger).toContainText("faux/faux-2");
    await trigger.click();
    await selector
      .getByRole("button", { name: "Faux Model", exact: true })
      .click();
    await expect(selector).toBeHidden();
    await page.reload();
    await expect(trigger).toContainText("faux/faux-1");
    await page.getByRole("button", { name: "Bot详情", exact: true }).click();
    await details.getByRole("button", { name: /^连接与账号(?:\s|$)/ }).click();
    await expect(source).toContainText("工作电脑已有配置");
  } finally {
    const exited = once(worker, "exit");
    worker.disconnect();
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});
