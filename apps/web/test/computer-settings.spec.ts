import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";
import {
  chooseAppearance,
  chooseDetail,
  openDetails,
} from "./fixtures/chat-ui.ts";
import { test } from "./fixtures/service.ts";

test("computer details share live directory status and recover a failed refresh", async ({
  service,
  page,
}) => {
  await page.goto(service.url);
  const details = await openDetails(page);
  await chooseDetail(details, "电脑");
  const computer = details.getByRole("region", {
    name: "工作目录与权限",
    exact: true,
  });
  await computer
    .getByRole("region", { name: "执行环境", exact: true })
    .locator("summary")
    .click();
  await expect(
    computer.getByRole("combobox", { name: "执行环境", exact: true }),
  ).toContainText("此电脑");
  await expect(computer.getByRole("button", { name: "启动电脑" })).toHaveCount(
    0,
  );
  await computer.getByRole("button", { name: "电脑设置", exact: true }).click();
  const settings = page.getByRole("main", {
    name: "设置",
    exact: true,
  });
  await settings.getByRole("button", { name: /^工作环境/ }).click();
  await page.route("**/rpc/computer/list", (route) => route.abort("failed"));
  await settings.getByRole("button", { name: "刷新电脑状态" }).click();
  await expect(page.locator(".attention-toast[data-error]")).toBeVisible();
  await page.unroute("**/rpc/computer/list");
  await settings.getByRole("button", { name: "刷新电脑状态" }).click();
  await expect(page.locator(".attention-toast[data-error]")).toHaveCount(0);
  await settings.getByRole("button", { name: "返回对话", exact: true }).click();
  await expect(settings).toHaveCount(0);
  await page.screenshot({ path: "test-results/computer-light.png" });
  await chooseAppearance(page, "深色");
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(
    computer.getByRole("button", { name: "电脑设置", exact: true }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/computer-mobile-dark.png" });
  await computer.getByRole("button", { name: "电脑设置", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(details).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Bot详情", exact: true }),
  ).toBeFocused();
});

test("computer ownership, project directories and access stay distinct", async ({
  service,
  page,
}, info) => {
  await page.goto(service.url);
  const rpc = async (method: string, json: object = {}) =>
    (
      await (
        await page.request.post(`${service.url}/rpc/${method}`, {
          data: { json },
        })
      ).json()
    ).json;
  const node = await rpc("computer/node");
  const before = await rpc("computer/list");
  await page.getByRole("button", { name: "用户菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  const settings = page.getByRole("main", { name: "设置", exact: true });
  await settings.getByRole("tab", { name: "当前电脑", exact: true }).click();
  await expect(
    settings.getByRole("combobox", { name: "新机器人使用" }),
  ).toHaveCount(0);
  await settings.getByRole("button", { name: "编辑电脑名称" }).click();
  await page
    .getByRole("textbox", { name: "电脑名称", exact: true })
    .fill("ASUS");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(async () => (await rpc("computer/node")).name).toBe("ASUS");
  expect((await rpc("computer/node")).id).toBe(node.id);
  await expect(
    settings.locator(".settings-sections[aria-label=电脑]"),
  ).toHaveAttribute("aria-busy", "false");
  const created = await rpc("bots/create", {
    name: "Writer",
    requestId: crypto.randomUUID(),
  });
  const after = await rpc("computer/list");
  for (const [id, binding] of Object.entries(before.bindings))
    expect(after.bindings[id]).toEqual(binding);
  expect(after.bindings[String(created.id)].computerId).toBe("process");
  await settings.getByRole("button", { name: "撤销授权", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "撤销授权", exact: true });
  await expect(confirm).toContainText("Domos");
  await confirm.getByRole("button", { name: "取消", exact: true }).click();
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 390, height: 900 });
    await expect
      .poll(() =>
        settings.evaluate((node) => node.scrollWidth <= node.clientWidth),
      )
      .toBe(true);
    await page.screenshot({ path: info.outputPath(`computer-${theme}.png`) });
  }
  await page.setViewportSize({ width: 1360, height: 900 });
  await settings.getByRole("button", { name: "返回对话", exact: true }).click();
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  await page.getByRole("tab", { name: "Computer", exact: true }).click();
  await page.getByRole("button", { name: "电脑设置", exact: true }).click();
  const project = join(service.directory, "project");
  await mkdir(project);
  await writeFile(join(project, "source.txt"), "project");
  await page.getByRole("button", { name: "更改目录", exact: true }).click();
  const picker = page.getByRole("dialog", {
    name: "选择工作目录",
    exact: true,
  });
  await picker.getByLabel("目录路径", { exact: true }).fill(project);
  await picker.getByRole("button", { name: "使用此目录", exact: true }).click();
  await expect(picker).toBeHidden();
  await expect(
    page.getByRole("complementary", { name: "Domos的详情", exact: true }),
  ).toContainText(project);
  await page.reload();
  expect(
    (
      await rpc("computer/get", {
        botId: Number(Object.keys(before.bindings)[0]),
      })
    ).directory,
  ).toBe(project);
});

test.use({ ignoreHTTPSErrors: true });

test("connection settings offer private networking and validate HTTPS before pairing", async ({
  service,
  page,
}, info) => {
  await service.stop();
  await service.start(0, "hosting");
  await page.goto(service.url);
  await page.getByLabel("配对码", { exact: true }).fill(service.pairing);
  await page.getByRole("button", { name: "确认连接", exact: true }).click();
  await page.getByRole("button", { name: "用户菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  const settings = page.getByRole("main", { name: "设置", exact: true });
  await settings.getByRole("tab", { name: "当前电脑", exact: true }).click();
  await settings.getByRole("button", { name: /^设备访问/ }).click();
  await settings
    .getByRole("button", { name: "连接新设备", exact: true })
    .click();
  await expect(
    settings.getByRole("radiogroup", { name: "连接方式", exact: true }),
  ).toBeVisible();
  await expect(
    settings.getByRole("button", { name: "重新检测 Tailscale" }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("private-connection.png") });
  await expect(
    settings.getByRole("button", { name: "生成配对链接" }),
  ).toHaveCount(0);
  await expect(settings.getByRole("img")).toHaveCount(0);
  expect(
    (
      await page.request.post(`${service.url}/hosting/pairing`, {
        headers: { origin: service.url },
        data: { scope: "client" },
      })
    ).status(),
  ).toBe(409);
  await settings
    .getByRole("radio", { name: "HTTPS 地址", exact: true })
    .click();
  await settings
    .getByRole("textbox", { name: "HTTPS 地址", exact: true })
    .fill("http://100.64.0.1:4310");
  await settings
    .getByRole("button", { name: "保存并检测", exact: true })
    .click();
  await expect(
    settings.getByText("请输入完整的 HTTPS 地址，不含路径、参数或配对码。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    settings.getByRole("button", { name: "保存并检测", exact: true }),
  ).toBeEnabled();
  await expect(
    settings.getByRole("button", { name: "生成配对链接" }),
  ).toHaveCount(0);
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => settings.evaluate((el) => el.scrollWidth <= el.clientWidth))
      .toBe(true);
    await page.screenshot({
      path: info.outputPath(`local-connection-${theme}.png`),
    });
  }
});

test("computer settings pair through HTTPS and preview explicit login revocation", async ({
  service,
  page,
  browser,
}, info) => {
  test.setTimeout(90_000);
  await service.stop();
  await service.start(0, "https");
  await page.goto(service.url);
  await page.getByLabel("设备名称", { exact: true }).fill("管理电脑");
  await page.getByLabel("配对码", { exact: true }).fill(service.pairing);
  await page.getByRole("button", { name: "确认连接", exact: true }).click();
  await page.getByRole("button", { name: "用户菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  const settings = page.getByRole("main", { name: "设置", exact: true });
  await settings.getByRole("tab", { name: "当前电脑", exact: true }).click();
  await expect(
    settings.getByRole("textbox", { name: "电脑名称", exact: true }),
  ).toHaveCount(0);
  await expect(settings.locator("summary")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("computer-overview.png") });
  await settings.getByRole("button", { name: /^设备访问/ }).click();
  await settings
    .getByRole("button", { name: "连接新设备", exact: true })
    .click();
  await expect(
    settings.getByRole("switch", { name: "允许管理 Domos" }),
  ).not.toBeChecked();
  await expect(
    settings.getByRole("textbox", { name: "HTTPS 地址", exact: true }),
  ).toHaveValue(service.url);
  await settings
    .getByRole("button", { name: "保存并检测", exact: true })
    .click();
  await expect(
    settings.getByRole("button", { name: "保存并检测", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("dialog", { name: "连接新设备", exact: true }),
  ).toHaveCount(0);
  await settings.getByRole("button", { name: "生成配对链接" }).click();
  await expect(settings.getByAltText("连接此 Domos 的二维码")).toBeVisible();
  const code = await settings.locator(".pairing-code").innerText();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await settings.getByRole("button", { name: "复制链接", exact: true }).click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(link).hash).toBe(`#pair=${code}`);
  await page.screenshot({ path: info.outputPath("connect-device.png") });
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => settings.evaluate((el) => el.scrollWidth <= el.clientWidth))
      .toBe(true);
    await settings
      .getByRole("button", { name: "复制链接", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      settings.getByRole("button", { name: "复制链接", exact: true }),
    ).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`pairing-${theme}.png`) });
  }
  await page.setViewportSize({ width: 1360, height: 900 });
  const remote = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const remotePage = await remote.newPage();
    await remotePage.goto(link);
    await expect(remotePage.getByLabel("配对码", { exact: true })).toHaveValue(
      code,
    );
    expect(new URL(remotePage.url()).hash).toBe("");
    expect(
      (await remote.request.get(`${service.url}/hosting/session`)).status(),
    ).toBe(401);
    await remotePage.getByLabel("设备名称", { exact: true }).fill("演示手机");
    await remotePage
      .getByRole("button", { name: "确认连接", exact: true })
      .click();
    await expect
      .poll(async () =>
        (await remote.request.get(`${service.url}/hosting/session`)).status(),
      )
      .toBe(200);
    expect(
      (
        await (
          await remote.request.get(`${service.url}/hosting/session`)
        ).json()
      ).device.scope,
    ).toBe("client");
    expect(
      (await remote.request.get(`${service.url}/hosting/devices`)).status(),
    ).toBe(403);
    expect(
      (
        await remote.request.post(`${service.url}/hosting/connection`, {
          headers: { origin: service.url },
          data: { mode: "off" },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await remote.request.post(`${service.url}/hosting/exchange`, {
          data: { code, label: "重复配对" },
          headers: { origin: service.url },
        })
      ).status(),
    ).toBe(401);
    await settings
      .getByRole("button", { name: "返回设备访问", exact: true })
      .click();
    await settings.getByRole("button", { name: "刷新设备" }).click();
    await settings.getByRole("button", { name: /^演示手机/ }).click();
    await expect(settings.getByText("有效至", { exact: true })).toBeVisible();
    await settings
      .getByRole("button", { name: "撤销访问", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "撤销 演示手机 的访问？", exact: true })
      .getByRole("button", { name: "撤销访问", exact: true })
      .click();
    await expect(
      settings.getByRole("button", { name: /^演示手机/ }),
    ).toHaveCount(0);
    expect(
      (await remote.request.get(`${service.url}/hosting/session`)).status(),
    ).toBe(401);
    const login = async (label: string) => {
      const response = await page.request.post(
        `${service.url}/hosting/pairing`,
        { headers: { origin: service.url }, data: { scope: "client" } },
      );
      expect(response.ok()).toBe(true);
      const pair = await response.json();
      const exchanged = await remote.request.post(
        `${service.url}/hosting/exchange`,
        { headers: { origin: service.url }, data: { code: pair.code, label } },
      );
      expect(exchanged.ok()).toBe(true);
      return (await exchanged.json()).device.id as string;
    };
    await login("旧登录 A");
    await login("旧登录 B");
    await settings.getByRole("button", { name: "刷新设备" }).click();
    await settings
      .getByRole("button", { name: "撤销其他登录", exact: true })
      .click();
    await expect(settings.getByText("旧登录 A", { exact: true })).toBeVisible();
    await expect(settings.getByText("旧登录 B", { exact: true })).toBeVisible();
    await settings.getByRole("button", { name: "取消", exact: true }).click();
    expect(
      (await remote.request.get(`${service.url}/hosting/session`)).status(),
    ).toBe(200);
    await settings
      .getByRole("button", { name: "撤销其他登录", exact: true })
      .click();
    const laterId = await login("后来连接的设备");
    await settings
      .getByRole("button", { name: "确认撤销其他登录", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "撤销这 2 条登录？", exact: true })
      .getByRole("button", { name: "撤销访问", exact: true })
      .click();
    await expect(settings.getByRole("button", { name: /^旧登录/ })).toHaveCount(
      0,
    );
    await expect(
      settings.getByRole("button", { name: /^后来连接的设备/ }),
    ).toBeVisible();
    expect(
      (
        await (
          await remote.request.get(`${service.url}/hosting/session`)
        ).json()
      ).device.id,
    ).toBe(laterId);
    expect(
      (await (await page.request.get(`${service.url}/hosting/session`)).json())
        .device.scope,
    ).toBe("admin");
  } finally {
    await remote.close();
  }
  await settings.getByRole("button", { name: /^管理电脑/ }).click();
  await expect(
    settings.getByRole("button", { name: "撤销访问", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(
    settings.getByRole("heading", { name: "设备访问", exact: true }),
  ).toBeVisible();
  await expect(
    settings.getByRole("button", { name: /^管理电脑/ }),
  ).toBeFocused();
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => settings.evaluate((el) => el.scrollWidth <= el.clientWidth))
      .toBe(true);
    await page.screenshot({ path: info.outputPath(`devices-${theme}.png`) });
  }
});

test("local container setup submits the selected browser network policy", async ({
  service,
  page,
}, testInfo) => {
  await page.goto(service.url);
  await page.getByRole("button", { name: "用户菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  const settings = page.getByRole("main", { name: "设置", exact: true });
  await settings.getByRole("tab", { name: "当前电脑", exact: true }).click();
  await settings.getByRole("button", { name: /^工作环境/ }).click();
  await settings
    .getByRole("button", { name: "添加容器环境", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "添加容器环境",
    exact: true,
  });
  const advanced = dialog.locator(".disclosure").filter({
    has: page.locator("summary", { hasText: "高级设置" }),
  });
  const heading = advanced.locator("summary");
  await expect(heading.locator("svg")).toBeVisible();
  await expect(dialog.getByLabel("工作镜像", { exact: true })).toBeHidden();
  await heading.focus();
  await heading.press("Enter");
  await expect(advanced).toHaveAttribute("open", "");
  await expect(dialog.getByLabel("工作镜像", { exact: true })).toBeVisible();
  await dialog
    .getByLabel("工作镜像", { exact: true })
    .fill("domos-workspace:3");
  await heading.press("Space");
  await expect(advanced).not.toHaveAttribute("open");
  await heading.click();
  await expect(heading).toHaveCSS("list-style-type", "none");
  await expect(
    dialog.getByRole("combobox", { name: "Docker 位置" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("combobox", { name: "网络策略" }),
  ).toContainText("关闭外部网络");
  await dialog.getByRole("combobox", { name: "网络策略" }).click();
  await page
    .getByRole("option", { name: "允许 HTTP(S) 网站", exact: true })
    .click();
  await dialog.getByLabel("代理镜像", { exact: true }).fill("domos-egress:1");
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await heading.scrollIntoViewIfNeeded();
    const row = await heading.boundingBox();
    const caret = await heading.locator("svg").boundingBox();
    if (!row || !caret) throw new Error("折叠栏不可见");
    expect(caret.x + caret.width).toBeCloseTo(row.x + row.width, 0);
    expect(caret.y + caret.height / 2).toBeCloseTo(row.y + row.height / 2, 0);
    await page.screenshot({
      path: testInfo.outputPath(`disclosure-${theme}.png`),
    });
  }
  await page.screenshot({
    path: testInfo.outputPath("remote-browser-network.png"),
  });
  const submitted = Promise.withResolvers<unknown>();
  await page.route("**/rpc/computer/add", async (route) => {
    submitted.resolve(route.request().postDataJSON());
    await route.abort();
  });
  await dialog.getByRole("button", { name: "添加环境", exact: true }).click();
  expect(JSON.stringify(await submitted.promise)).toContain('"network":"web"');
  expect(JSON.stringify(await submitted.promise)).toContain(
    '"proxyImage":"domos-egress:1"',
  );
  expect(JSON.stringify(await submitted.promise)).not.toContain('"ssh"');
  await expect(dialog.getByRole("alert")).toBeVisible();
});

test("computer settings separate daily access from Jev credentials", async ({
  service,
  page,
}, info) => {
  let assistant = {
    computerId: "process",
    revision: 0,
    enabled: false,
    provider: "typesafe",
    configured: { typesafe: false, openrouter: false },
    available: true,
  };
  let services = {
    browser: { enabled: true, available: true, mode: "headless" },
    desktop: { enabled: true, available: true },
  };
  let modeChanges = 0;
  let serviceReads = 0;
  let connectionFails = true;
  await page.route("**/rpc/computer/assistant", (route) =>
    route.fulfill({ json: { json: assistant } }),
  );
  await page.route("**/rpc/computer/assistantConfigure", (route) => {
    const input = route.request().postDataJSON().json;
    assistant = { ...assistant, ...input, revision: assistant.revision + 1 };
    return route.fulfill({ json: { json: assistant } });
  });
  await page.route("**/rpc/computer/assistantKey", (route) => {
    const input = route.request().postDataJSON().json;
    assistant.configured[input.provider as "typesafe" | "openrouter"] = Boolean(
      input.key,
    );
    return route.fulfill({ json: { json: assistant } });
  });
  await page.route("**/rpc/computer/assistantTest", (route) =>
    connectionFails
      ? route.abort()
      : route.fulfill({ json: { json: { milliseconds: 42 } } }),
  );
  await page.route("**/rpc/computer/services", (route) => {
    serviceReads++;
    return route.fulfill({ json: { json: services } });
  });
  await page.route("**/rpc/computer/browserMode", (route) => {
    expect(route.request().postDataJSON().json).toMatchObject({
      mode: "headed",
      confirmRestart: true,
    });
    modeChanges++;
    services = {
      ...services,
      browser: { ...services.browser, mode: "headed" },
    };
    return route.fulfill({ json: { json: services } });
  });
  await page.goto(service.url);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  const details = page.locator("#bot-details");
  await details
    .getByRole("button", { name: "工作目录与权限", exact: true })
    .click();
  for (const name of ["工作目录", "电脑权限", "辅助操作", "执行环境"])
    await expect(
      details.getByRole("region", { name, exact: true }),
    ).toBeVisible();
  await expect(details.getByRole("textbox")).toHaveCount(0);
  await expect(
    details.getByRole("combobox", { name: "执行环境" }),
  ).toBeHidden();
  const browser = details.getByRole("group", { name: "浏览器", exact: true });
  const mode = details.getByRole("group", { name: "浏览器模式", exact: true });
  expect((await browser.boundingBox())?.y).toBeLessThan(
    (await mode.boundingBox())?.y ?? 0,
  );
  await mode.getByRole("button", { name: "尝试有界面模式" }).click();
  const confirm = page.getByRole("dialog", { name: "重启并切换浏览器？" });
  await confirm.getByRole("button", { name: "取消", exact: true }).click();
  expect(modeChanges).toBe(0);
  await mode.getByRole("button", { name: "尝试有界面模式" }).click();
  await confirm.getByRole("button", { name: "确认重启", exact: true }).click();
  await expect(mode).toContainText("有界面");
  expect(modeChanges).toBe(1);
  const enabled = details.getByRole("switch", { name: "启用辅助决策" });
  await expect(enabled).toBeDisabled();
  await details.getByRole("button", { name: "配置", exact: true }).click();
  await expect(details.locator(".panel-header h2")).toHaveText("Jev 辅助操作");
  expect(serviceReads).toBe(1);
  await expect(details.getByRole("button", { name: "更改目录" })).toHaveCount(
    0,
  );
  const source = details.getByRole("radio", {
    name: "OpenRouter",
    exact: true,
  });
  await source.click();
  await expect(source).toBeChecked();
  const key = details.getByLabel("OpenRouter API 密钥", { exact: true });
  await key.fill("ui-test-key");
  await details.getByRole("button", { name: "保存密钥", exact: true }).click();
  await expect(key).toHaveValue("");
  await expect(details.getByRole("status")).toContainText("已配置");
  await details.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(details.getByRole("alert")).toBeVisible();
  connectionFails = false;
  await details.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(details.getByRole("status").last()).toContainText("已连接");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        details.evaluate((node) => node.scrollWidth <= node.clientWidth),
      )
      .toBe(true);
    await details.screenshot({
      path: info.outputPath(`jev-${colorScheme}.png`),
    });
  }
  await details.getByRole("button", { name: "返回", exact: true }).click();
  await expect(details.locator(".panel-header h2")).toHaveText(
    "工作目录与权限",
  );
  await expect(enabled).toBeEnabled();
  await enabled.click();
  await expect(enabled).toBeChecked();
  await expect(details.getByRole("region", { name: "辅助操作" })).toContainText(
    "已启用",
  );
  await details.getByRole("button", { name: "配置", exact: true }).click();
  await details.getByRole("button", { name: "移除密钥", exact: true }).click();
  await expect(details.getByRole("status")).toContainText("未配置");
  await expect(
    details.getByRole("button", { name: "测试连接", exact: true }),
  ).toBeDisabled();
  await details.getByRole("button", { name: "返回", exact: true }).click();
  await expect(enabled).toBeEnabled();
  await enabled.click();
  await expect(enabled).not.toBeChecked();
  await expect(enabled).toBeDisabled();
  await details
    .getByRole("region", { name: "执行环境", exact: true })
    .locator("summary")
    .click();
  await expect(
    details.getByRole("combobox", { name: "执行环境" }),
  ).toBeVisible();
});

test("computer viewing uses separate tabs and releases control when closed", async ({
  service,
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(service.url);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  await page.getByRole("tab", { name: "Computer", exact: true }).click();
  const details = page.locator("#bot-details");
  const identity = details.locator(".detail-identity");
  await expect(identity).toBeInViewport({ ratio: 1 });
  const first = await identity.boundingBox();
  await expect(details.locator(".bot-hero")).toHaveCount(1);
  await details.getByRole("button", { name: "电脑设置", exact: true }).click();
  await details.getByRole("button", { name: "返回", exact: true }).click();
  await expect(
    details.getByRole("tab", { name: "Computer", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await details.getByRole("tab", { name: "Browser", exact: true }).click();
  expect(await identity.boundingBox()).toEqual(first);
  const view = page.getByRole("region", { name: "Domos的电脑", exact: true });
  await view.getByRole("button", { name: "启用浏览器", exact: true }).click();
  const screen = view.getByRole("img", { name: "工作电脑画面" });
  await expect(screen).toBeVisible({ timeout: 30000 });
  const status = view.getByRole("status", { name: "屏幕状态", exact: true });
  await expect(status).toHaveText("实时");
  await expect(status.locator("span").first()).toHaveCSS(
    "background-color",
    "rgb(37, 216, 132)",
  );
  await expect(
    view.getByRole("textbox", { name: "网址", exact: true }),
  ).toHaveCount(0);
  await expect(view.getByRole("tab")).toHaveCount(0);
  await view.getByRole("button", { name: "接管", exact: true }).click();
  await expect(
    view.getByRole("status", { name: "屏幕状态", exact: true }),
  ).toHaveText("你正在操作");
  expect((await view.boundingBox())?.width).toBeLessThan(700);
  await view.getByRole("button", { name: "展开工作区", exact: true }).click();
  await expect
    .poll(async () => (await view.boundingBox())?.width)
    .toBeGreaterThan(800);
  await view.getByRole("button", { name: "收起工作区", exact: true }).click();
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(status.locator("span").first()).toHaveCSS(
      "background-color",
      "rgb(37, 216, 132)",
    );
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(screen).toBeInViewport({ ratio: 1 });
      await expect(
        view.getByRole("button", { name: "全屏", exact: true }),
      ).toBeInViewport();
      await page.screenshot({
        path: info.outputPath(`computer-${theme}-${width}.png`),
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
    }
  }
  await view.getByRole("button", { name: "交还", exact: true }).click();
  await details.getByRole("tab", { name: "Computer", exact: true }).click();
  await expect(
    view.getByRole("button", { name: "启用桌面", exact: true }),
  ).toBeVisible();
  expect((await identity.boundingBox())?.height).toBe(first?.height);
  await details.getByRole("tab", { name: "Bot", exact: true }).click();
  await expect(
    details.getByRole("combobox", { name: "模型", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.route("**/rpc/computer/services", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.json.browser.available = false;
    body.json.browser.error = "旧检测结果";
    await route.fulfill({ response, json: body });
  });
  await details.getByRole("tab", { name: "Browser", exact: true }).click();
  await expect(
    view.getByRole("button", { name: "接管", exact: true }),
  ).toBeVisible();
  await service.control("disconnect-clients");
  await expect(status).toHaveText("已断开");
  await expect(screen).toBeVisible();
  await expect(status.locator("span").first()).toHaveCSS(
    "background-color",
    "rgb(255, 82, 101)",
  );
  await details.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Bot详情", exact: true }),
  ).toBeFocused();
});

for (const [error, action, install] of [
  [
    JSON.stringify({ code: "outcome_unknown", error: "Invalid response: EOF" }),
    "重新连接",
    false,
  ],
  ["Chrome not found. Run agent-browser install.", "安装并连接浏览器", true],
] as const) {
  test(`browser recovery offers ${action} for the native failure`, async ({
    service,
    page,
  }, info) => {
    const state = {
      browser: { enabled: true, available: false, mode: "headed", error },
      desktop: { enabled: false, available: false },
    };
    await page.route("**/rpc/computer/services", (route) =>
      route.fulfill({ json: { json: state } }),
    );
    let attempts = 0;
    const opening = Promise.withResolvers<void>();
    await page.route("**/rpc/computer/watch", async (route) => {
      attempts++;
      await opening.promise;
      return route.fulfill({
        status: 400,
        json: {
          json: {
            defined: false,
            code: "BAD_REQUEST",
            status: 400,
            message: error,
          },
        },
      });
    });
    const submitted = Promise.withResolvers<unknown>();
    await page.route("**/rpc/computer/service", async (route) => {
      submitted.resolve(route.request().postDataJSON());
      await route.fulfill({ json: { json: state } });
    });
    await page.goto(service.url);
    await page.getByRole("button", { name: "Bot详情", exact: true }).click();
    await page.getByRole("tab", { name: "Browser", exact: true }).click();
    const view = page.getByRole("region", { name: "Domos的电脑", exact: true });
    await expect(
      view.getByRole("status", { name: "正在连接画面", exact: true }),
    ).toBeVisible();
    const status = view.getByRole("status", { name: "屏幕状态", exact: true });
    await expect(status).toHaveText("连接中");
    await expect(
      status.getByRole("img", { name: "连接中", exact: true }),
    ).toBeVisible();
    opening.resolve();
    await expect(view.getByRole("alert")).toContainText(error);
    await expect(status).toHaveText("已断开");
    await expect(status.locator("span").first()).toHaveCSS(
      "background-color",
      "rgb(255, 82, 101)",
    );
    await page.screenshot({ path: info.outputPath("browser-recovery.png") });
    await view.getByRole("button", { name: action, exact: true }).click();
    if (install)
      expect(await submitted.promise).toMatchObject({
        json: { service: "browser", enabled: true, install },
      });
    else await expect.poll(() => attempts).toBe(2);
  });
}

test("computer connection failures keep a direct retry", async ({
  service,
  page,
}) => {
  await page.route("**/rpc/computer/services", (route) =>
    route.abort("failed"),
  );
  await page.goto(service.url);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  await page.getByRole("tab", { name: "Computer", exact: true }).click();
  const view = page.getByRole("region", {
    name: "Domos的电脑",
    exact: true,
  });
  await expect(page.getByRole("alert")).toContainText("无法读取电脑状态");
  await expect(
    view.getByRole("heading", { name: "电脑暂时无法连接" }),
  ).toBeVisible();
  await page.unroute("**/rpc/computer/services");
  await page
    .getByRole("alert")
    .getByRole("button", { name: "重试", exact: true })
    .click();
  await expect(
    view.getByRole("button", { name: "启用桌面", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
