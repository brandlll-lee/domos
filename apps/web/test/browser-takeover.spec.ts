import { type ChildProcess, fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

let worker: ChildProcess;
let directory: string;
let url: string;
test.beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "domos-takeover-"));
  worker = fork(
    fileURLToPath(
      new URL("../../api/test/fixtures/web-server.ts", import.meta.url),
    ),
    [join(directory, "data.sqlite"), "0"],
    { silent: true, execArgv: [] },
  );
  worker.stdout?.resume();
  worker.stderr?.resume();
  const [ready] = await once(worker, "message");
  url = `http://127.0.0.1:${ready.port}`;
});
test.afterEach(async () => {
  if (worker.connected) {
    const exited = once(worker, "exit");
    worker.disconnect();
    await exited;
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 5 });
});

test("takeover controls the depicted browser through real page input", async ({
  page,
  request,
}, info) => {
  test.setTimeout(120_000);
  const state = async () => (await request.get(`${url}/takeover-state`)).json();
  await page.goto(url);
  await page.getByRole("button", { name: "Bot电脑", exact: true }).click();
  const view = page.getByRole("region", { name: "Domos的电脑", exact: true });
  await view.getByRole("button", { name: "启用浏览器", exact: true }).click();
  const image = view.getByRole("img", { name: "工作电脑画面" });
  await expect(image).toBeVisible();
  const address = view.getByRole("textbox", { name: "网址", exact: true });
  await expect(address).toBeDisabled();
  await view.getByRole("button", { name: "接管", exact: true }).click();
  await expect(address).toBeEnabled();
  await address.fill(`${url}/takeover-fixture`);
  await view.getByRole("button", { name: "打开", exact: true }).click();
  await expect.poll(async () => (await state()).value).toBe("saved draft");
  await expect(address).toHaveValue(`${url}/takeover-fixture`);
  await expect(view.getByLabel("输入到网页中已选中的位置")).toHaveCount(0);
  const point = async (name: string, fraction = 0.5) => {
    const current = await state();
    await expect
      .poll(() =>
        image.evaluate(
          (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
        ),
      )
      .toBe(true);
    const rect = await image.boundingBox();
    if (!rect) throw new Error("Page image missing");
    const target = current[name];
    return {
      x:
        rect.x +
        ((target.x + target.width * fraction) * rect.width) / current.width,
      y:
        rect.y +
        ((target.y + target.height / 2) * rect.height) / current.height,
    };
  };
  const click = async (name: string) => {
    const at = await point(name);
    await page.mouse.click(at.x, at.y);
  };
  await click("draft");
  const input = view.getByRole("textbox", {
    name: "网页键盘输入",
    exact: true,
  });
  await expect(input).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.insertText("追加中文");
  await expect
    .poll(async () => (await state()).value)
    .toBe("saved draft追加中文");
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.insertText("上海天气");
  await expect.poll(async () => (await state()).value).toBe("上海天气");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Backspace");
  await expect.poll(async () => (await state()).value).toBe("上海气");
  await page.keyboard.press("End");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => navigator.clipboard.writeText(" 粘贴"));
  await page.keyboard.press(`${modifier}+v`);
  await expect.poll(async () => (await state()).value).toBe("上海气 粘贴");
  const ime = await page.context().newCDPSession(page);
  await ime.send("Input.imeSetComposition", {
    text: "中文",
    selectionStart: 2,
    selectionEnd: 2,
  });
  expect((await state()).value).toBe("上海气 粘贴");
  await ime.send("Input.insertText", { text: "中文" });
  await ime.detach();
  await expect.poll(async () => (await state()).value).toBe("上海气 粘贴中文");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("next field");
  await expect.poll(async () => (await state()).next).toBe("next field");
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await state()).keys.includes("Enter"))
    .toBe(true);
  await click("confirm");
  await expect
    .poll(async () => (await state()).confirmed)
    .toBe("上海气 粘贴中文");
  const dragStart = await point("draft", 0.025);
  const dragEnd = await point("draft", 0.3);
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const selected = (await state()).selection;
      return selected[1] - selected[0];
    })
    .toBeGreaterThan(0);
  const cancelled = await point("confirm");
  await page.mouse.move(cancelled.x, cancelled.y);
  await page.mouse.down();
  await page.keyboard.press("Shift+Escape");
  await page.mouse.up();
  const hover = await point("hover");
  await page.mouse.move(hover.x, hover.y);
  await expect.poll(async () => (await state()).hovered).toBe(true);
  expect((await state()).clicks).toBe(1);
  const scroll = await point("draft");
  await page.mouse.move(scroll.x, scroll.y);
  await page.mouse.wheel(0, 300);
  await expect.poll(async () => (await state()).scrollY).toBeGreaterThan(0);
  const scrolledFrame = await image.getAttribute("src");
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await state()).scrollY).toBe(0);
  await expect(image).not.toHaveAttribute("src", scrolledFrame ?? "");
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      view.getByRole("button", { name: "交还控制权" }),
    ).toBeInViewport();
    await expect(image).toBeInViewport({ ratio: 1 });
    const field = await address.boundingBox();
    const button = await view
      .getByRole("button", { name: "打开", exact: true })
      .boundingBox();
    expect(field?.height).toBe(button?.height);
    expect(field?.y).toBe(button?.y);
    await page.screenshot({ path: info.outputPath(`takeover-${width}.png`) });
  }
  await view.getByRole("button", { name: "交还控制权", exact: true }).click();
  await expect(address).toBeDisabled();
  await expect(input).toBeDisabled();
  expect((await state()).value).toBe("上海气 粘贴中文");
});

test("takeover preserves a failed input and recovers through a fresh connection", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.goto(url);
  await page.getByRole("button", { name: "Bot电脑", exact: true }).click();
  const view = page.getByRole("region", { name: "Domos的电脑", exact: true });
  await view.getByRole("button", { name: "启用浏览器", exact: true }).click();
  await view.getByRole("button", { name: "接管", exact: true }).click();
  const address = view.getByRole("textbox", { name: "网址", exact: true });
  await address.fill(`${url}/takeover-fixture`);
  await view.getByRole("button", { name: "打开", exact: true }).click();
  const state = async () => (await request.get(`${url}/takeover-state`)).json();
  await expect.poll(async () => (await state()).value).toBe("saved draft");
  const image = view.getByRole("img", { name: "工作电脑画面" });
  await expect
    .poll(() => image.evaluate((node: HTMLImageElement) => node.complete))
    .toBe(true);
  const rect = await image.boundingBox();
  if (!rect) throw new Error("Browser image missing");
  const target = await state();
  await page.mouse.click(
    rect.x +
      ((target.draft.x + target.draft.width / 2) * rect.width) / target.width,
    rect.y +
      ((target.draft.y + target.draft.height / 2) * rect.height) /
        target.height,
  );
  await view.getByRole("button", { name: "输入文字", exact: true }).click();
  const draft = view.getByRole("textbox", {
    name: "输入到网页中已选中的位置",
    exact: true,
  });
  await draft.fill("保留草稿");
  const draftBox = await draft.boundingBox();
  const submitBox = await view
    .getByRole("button", { name: "输入", exact: true })
    .boundingBox();
  expect(draftBox?.height).toBe(submitBox?.height);
  expect(draftBox?.y).toBe(submitBox?.y);
  let textCalls = 0;
  await page.route("**/rpc/computer/input", async (route) => {
    if (route.request().postDataJSON()?.json?.action?.type === "text") {
      textCalls++;
      await route.abort();
    } else await route.continue();
  });
  await view.getByRole("button", { name: "输入", exact: true }).click();
  await expect(view.getByRole("alert")).toBeVisible();
  await expect(view.getByRole("status")).toHaveText("操作已暂停");
  await expect(draft).toHaveValue("保留草稿");
  await expect(
    view.getByRole("button", { name: "输入", exact: true }),
  ).toBeDisabled();
  expect(textCalls).toBe(1);
  expect((await state()).value).toBe("saved draft");
  await page.unroute("**/rpc/computer/input");
  await view.getByRole("button", { name: "重新连接", exact: true }).click();
  await expect(
    view.getByRole("button", { name: "接管", exact: true }),
  ).toBeEnabled();
  await view.getByRole("button", { name: "接管", exact: true }).click();
  await expect(draft).toHaveValue("保留草稿");
  await view.getByRole("button", { name: "输入", exact: true }).click();
  await expect.poll(async () => (await state()).value).toContain("保留草稿");
  await expect(draft).toHaveValue("");
});
