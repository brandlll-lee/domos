import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { expect } from "@playwright/test";
import { test } from "./fixtures/service.ts";

const it = test.extend({ trace: "off" });

it("chat reflows within the frame budget and retains its position", async ({
  service,
  page,
}) => {
  test.setTimeout(60000);
  let receipt = once(service.worker, "message");
  service.worker.send({ history: 160 });
  await receipt;
  await page.setViewportSize({ width: 1600, height: 960 });
  await page.goto(service.url);
  receipt = once(service.worker, "message");
  service.worker.send({
    content:
      "这是一段用来检查拖拽时阅读位置的长消息，需要在容器改变宽度时保持最新消息的底边稳定。".repeat(
        4,
      ) +
      "\n\n| 职位 | 地点 | 薪酬 |\n| --- | --- | --- |\n| 工程师 | Remote | $100,000 |",
  });
  await receipt;
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .fill("检查布局");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".message table").last()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "语音输入（暂未开放）", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator(".transcript")
        .evaluate(
          (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
        ),
    )
    .toBeLessThanOrEqual(1);
  const frames = await page.evaluateHandle(() => {
    const viewport = document.querySelector<HTMLElement>(".transcript");
    if (!viewport) throw new Error("Transcript missing");
    const times: number[] = [];
    let frame = 0;
    const sample = (time: number) => {
      times.push(time);
      frame = requestAnimationFrame(sample);
    };
    return {
      start() {
        times.length = 0;
        frame = requestAnimationFrame(sample);
      },
      finish(slowFrame = 25) {
        cancelAnimationFrame(frame);
        let previous = times[0] ?? 0;
        const gaps = times.slice(1).map((time) => {
          const gap = time - previous;
          previous = time;
          return gap;
        });
        gaps.sort((a, b) => a - b);
        return {
          gap:
            viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop,
          count: gaps.length,
          p95: gaps[Math.floor(gaps.length * 0.95)],
          slow: gaps.filter((time) => time > slowFrame).length / gaps.length,
        };
      },
    };
  });
  const session = await page.context().newCDPSession(page);
  await session.send("Performance.enable", { timeDomain: "threadTicks" });
  const metrics = async () => {
    const { metrics } = await session.send("Performance.getMetrics");
    const read = (name: string) => {
      const value = metrics.find((metric) => metric.name === name)?.value;
      if (value === undefined)
        throw new Error(`Missing performance metric: ${name}`);
      return value;
    };
    return {
      layouts: read("LayoutCount"),
      layoutMs: (read("LayoutDuration") + read("RecalcStyleDuration")) * 1000,
    };
  };
  await session.send("Emulation.setCPUThrottlingRate", { rate: 2 });
  await frames.evaluate((recording) => recording.start());
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let count = 0;
        const sample = () => {
          if (++count === 30) resolve();
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
  );
  const baseline = await frames.evaluate((recording) => recording.finish());
  console.log(`Idle frame timing: ${JSON.stringify(baseline)}`);
  if (baseline.p95 === undefined) throw new Error("Idle frame timing missing");
  const slowFrame = Math.max(25, baseline.p95 * 1.5);
  for (const side of ["联系人", "详情"]) {
    const handle = page.getByRole("separator", { name: `调整${side}宽度` });
    const box = await handle.boundingBox();
    const messages = page.locator(".messages");
    const input = page.getByRole("textbox", { name: "消息", exact: true });
    const body = await messages.boundingBox();
    const composer = await input.boundingBox();
    if (!box || !body || !composer) throw new Error("Chat layout missing");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(page.locator(".workspace-content")).toHaveAttribute(
      "data-resizing",
      "true",
    );
    const before = await metrics();
    await frames.evaluate((recording) => recording.start());
    await page.mouse.move(
      box.x + (side === "联系人" ? 60 : -240),
      box.y + box.height / 2,
      { steps: 50 },
    );
    expect((await messages.boundingBox())?.width).not.toBe(body.width);
    expect((await input.boundingBox())?.width).not.toBe(composer.width);
    await page.mouse.move(
      box.x + (side === "联系人" ? -40 : 60),
      box.y + box.height / 2,
      { steps: 50 },
    );
    expect((await messages.boundingBox())?.width).not.toBe(body.width);
    expect(
      await page.evaluate(() => Boolean(document.activeViewTransition)),
    ).toBe(false);
    const measured = await frames.evaluate(
      (recording, threshold) => recording.finish(threshold),
      slowFrame,
    );
    const after = await metrics();
    const layouts = after.layouts - before.layouts;
    const layoutMs = after.layoutMs - before.layoutMs;
    await page.mouse.up();
    await expect(page.locator(".workspace-content")).not.toHaveAttribute(
      "data-resizing",
    );
    await page.evaluate(() => document.activeViewTransition?.finished);
    expect((await messages.boundingBox())?.width).not.toBe(body.width);
    console.log(
      `${side} resize: ${JSON.stringify({ ...measured, layouts, layoutMs })}`,
    );
    expect(measured.count).toBeGreaterThan(30);
    expect(measured.gap).toBeLessThanOrEqual(1);
    expect(layouts).toBeGreaterThan(0);
    expect(layoutMs / measured.count).toBeLessThanOrEqual(1000 / 60);
  }
  await session.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await input.fill("调整窗口时保留的草稿");
  for (const width of [1400, 1200, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        page.locator(".messages").evaluate((element) => {
          const transcript = document.querySelector(".transcript");
          if (!transcript) throw new Error("Transcript missing");
          const available =
            transcript.clientWidth -
            2 * Number.parseFloat(getComputedStyle(transcript).paddingLeft);
          const cap =
            60 *
            Number.parseFloat(
              getComputedStyle(document.documentElement).fontSize,
            );
          return Math.abs(
            element.getBoundingClientRect().width - Math.min(cap, available),
          );
        }),
      )
      .toBeLessThan(1);
    await expect(input).toHaveText("调整窗口时保留的草稿");
    await expect
      .poll(() =>
        page
          .locator(".transcript")
          .evaluate(
            (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
          ),
      )
      .toBeLessThanOrEqual(1);
  }
  await frames.dispose();
});

test("contacts snap to an icon column and restore their width without losing chat state", async ({
  service,
  page,
}, info) => {
  await page.setViewportSize({ width: 1600, height: 960 });
  await page.goto(service.url);
  const workspace = page.locator(".workspace");
  const sidebar = page.locator('.workspace-panel[data-side="sidebar"]');
  const handle = page.getByRole("separator", { name: "调整联系人宽度" });
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await input.fill("收起侧栏仍保留的草稿");
  const box = await handle.boundingBox();
  const width = Number(await handle.getAttribute("aria-valuenow"));
  if (!box) throw new Error("Contact resize handle missing");
  const x = box.x + box.width / 2;
  const y = box.y + 120;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 208 - width, y, { steps: 4 });
  await expect(handle).toHaveAttribute("aria-valuenow", "208");
  await workspace.evaluate((root) => {
    const panel = root.querySelector('.workspace-panel[data-side="sidebar"]');
    const chat = root.querySelector(".conversation");
    if (!panel || !chat) throw new Error("Workspace missing");
    const avatar = root.querySelector(".contact-row .bot-avatar");
    if (!avatar) throw new Error("Contact avatar missing");
    const frames: [number, number, number][] = [];
    root.setAttribute("data-sampling", "true");
    const sample = () => {
      const box = panel.getBoundingClientRect();
      frames.push([
        box.width,
        Math.abs(box.right - chat.getBoundingClientRect().left),
        avatar.getBoundingClientRect().top,
      ]);
      root.setAttribute("data-snap-frames", JSON.stringify(frames));
      if (root.hasAttribute("data-sampling")) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.mouse.move(x + 176 - width, y);
  await expect(workspace).toHaveAttribute("data-sidebar-compact", "true");
  await expect(handle).toHaveAttribute("aria-valuenow", "96");
  expect(
    await page.evaluate(() => localStorage.getItem("domos:layout:v1")),
  ).toBeNull();
  await page.mouse.move(x + 200 - width, y);
  await expect(handle).toHaveAttribute("aria-valuenow", "96");
  await page.mouse.up();
  await expect(sidebar).toHaveCSS("width", "96px");
  const snapFrames = await workspace.evaluate((root) => {
    root.removeAttribute("data-sampling");
    return JSON.parse(root.getAttribute("data-snap-frames") ?? "[]") as [
      number,
      number,
      number,
    ][];
  });
  expect(snapFrames.some(([width]) => width > 97 && width < 207)).toBe(true);
  expect(Math.max(...snapFrames.map(([, gap]) => gap))).toBeLessThanOrEqual(1);
  const firstY = snapFrames[0]?.[2];
  const lastY = snapFrames.at(-1)?.[2];
  if (firstY === undefined || lastY === undefined)
    throw new Error("Snap frames missing");
  expect(snapFrames.some(([, , y]) => y > firstY + 1 && y < lastY - 1)).toBe(
    true,
  );
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("domos:layout:v1") ?? "{}"),
  );
  expect(stored).toMatchObject({ sidebar: 208, collapsed: true });
  await expect(sidebar.locator(".chat-preview").first()).toBeHidden();
  await expect(
    sidebar.getByRole("link", { name: "Domos", exact: true }),
  ).toHaveAttribute("title", "Domos");
  await expect(
    sidebar.getByRole("button", { name: "新建", exact: true }),
  ).toBeVisible();
  await expect(
    sidebar.getByRole("button", { name: "用户菜单", exact: true }),
  ).toBeVisible();
  expect((await sidebar.boundingBox())?.width).toBe(96);
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const contact = sidebar.locator('.contact-row[aria-current="page"]');
    const searchButton = sidebar.getByRole("button", {
      name: "搜索联系人和聊天记录",
      exact: true,
    });
    const contactBox = await contact.boundingBox();
    if (!contactBox) throw new Error("Contact missing");
    expect(contactBox.width).toBeCloseTo(54, 0);
    expect(contactBox.height).toBeCloseTo(contactBox.width, 1);
    expect(Math.abs(contactBox.x + contactBox.width / 2 - 48)).toBeLessThan(1);
    const matchingBackgrounds = async () =>
      (await contact.evaluate(
        (node) => getComputedStyle(node).backgroundColor,
      )) ===
      (await searchButton.evaluate(
        (node) => getComputedStyle(node).backgroundColor,
      ));
    await expect.poll(matchingBackgrounds).toBe(true);
    await searchButton.hover();
    await searchButton.evaluate((node) =>
      Promise.all(node.getAnimations().map((animation) => animation.finished)),
    );
    const hover = await searchButton.evaluate(
      (node) => getComputedStyle(node).backgroundColor,
    );
    await contact.hover();
    await expect(contact).toHaveCSS("background-color", hover);
    await page.mouse.move(400, 800);
    await page.screenshot({
      path: info.outputPath(`contacts-compact-${theme}.png`),
      animations: "disabled",
    });
  }
  await page.reload();
  await expect(workspace).toHaveAttribute("data-sidebar-compact", "true");
  await expect(input).toHaveText("收起侧栏仍保留的草稿");
  await sidebar
    .getByRole("button", { name: "搜索联系人和聊天记录", exact: true })
    .click();
  const search = sidebar.getByRole("searchbox");
  await expect(search).toBeFocused();
  await expect(handle).toHaveAttribute("aria-valuenow", "208");
  await search.fill("不存在的联系人");
  await workspace.evaluate((root) => {
    root.addEventListener(
      "transitionrun",
      () => {
        const panel = root.querySelector(
          '.workspace-panel[data-side="sidebar"]',
        );
        for (const node of [root, panel]) {
          for (const animation of node?.getAnimations() ?? []) {
            if (!(animation instanceof CSSTransition)) continue;
            if (
              !["width", "grid-template-columns"].includes(
                animation.transitionProperty,
              )
            )
              continue;
            animation.pause();
            animation.currentTime =
              Number(animation.effect?.getTiming().duration) / 2;
          }
        }
      },
      { once: true },
    );
  });
  await handle.dblclick();
  await expect(workspace).toHaveAttribute("data-sidebar-compact", "true");
  await handle.dblclick();
  await expect(handle).toHaveAttribute("aria-valuenow", "208");
  await expect(search).toHaveValue("不存在的联系人");
  await search.fill("");
  await handle.press("Home");
  await expect(handle).toHaveAttribute("aria-valuenow", "96");
  await expect(sidebar).toHaveCSS("width", "96px");
  const rail = await handle.boundingBox();
  if (!rail) throw new Error("Compact resize handle missing");
  await page.mouse.move(rail.x + rail.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(rail.x + rail.width / 2 + 144, y, { steps: 5 });
  await expect(handle).toHaveAttribute("aria-valuenow", "240");
  await page.mouse.up();
  await expect(sidebar).toHaveCSS("width", "240px");
  await handle.press("Home");
  await expect(handle).toHaveAttribute("aria-valuenow", "96");
  await workspace.evaluate((root) => {
    const panel = root.querySelector('.workspace-panel[data-side="sidebar"]');
    if (!panel) throw new Error("Sidebar missing");
    for (const animation of [
      ...root.getAnimations(),
      ...panel.getAnimations(),
    ]) {
      if (!(animation instanceof CSSTransition)) continue;
      animation.pause();
      animation.currentTime = 80;
    }
  });
  const moving = await handle.boundingBox();
  const currentWidth = (await sidebar.boundingBox())?.width;
  if (!moving || !currentWidth) throw new Error("Moving sidebar missing");
  expect(currentWidth).toBeGreaterThan(96);
  expect(currentWidth).toBeLessThan(240);
  await page.mouse.move(moving.x + moving.width / 2, y);
  await page.mouse.down();
  expect((await sidebar.boundingBox())?.width).toBeCloseTo(currentWidth, 0);
  await page.mouse.move(moving.x + moving.width / 2 + 150, y);
  await expect(handle).toHaveAttribute(
    "aria-valuenow",
    String(Math.round(currentWidth + 150)),
  );
  expect((await sidebar.boundingBox())?.width).toBeCloseTo(
    currentWidth + 150,
    0,
  );
  await page.mouse.up();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await handle.press("Home");
  await handle.press("ArrowRight");
  await expect(handle).toHaveAttribute("aria-valuenow", "232");
  await expect(sidebar).toHaveCSS("width", "232px");
  await expect(workspace).not.toHaveAttribute("data-sidebar-snapping");
  expect(await workspace.evaluate((root) => root.getAnimations().length)).toBe(
    0,
  );
  await handle.press("Home");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "联系人", exact: true }).click();
  await expect(sidebar.getByRole("searchbox")).toBeVisible();
  await expect(sidebar.locator(".chat-preview").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1600, height: 960 });
  await expect(workspace).toHaveAttribute("data-sidebar-compact", "true");
  await expect(input).toHaveText("收起侧栏仍保留的草稿");
});

test("panels resize live, persist only on release, and retain drafts across layouts", async ({
  service,
  page,
}) => {
  await page.goto(service.url);
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await input.fill("保留消息草稿");
  const left = page.getByRole("separator", { name: "调整联系人宽度" });
  const before = Number(await left.getAttribute("aria-valuenow"));
  const box = await left.boundingBox();
  if (!box) throw new Error("Resize handle missing");
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + 100, { steps: 8 });
  await expect(left).toHaveAttribute("aria-valuenow", String(before + 40));
  expect(
    await page.evaluate(() => localStorage.getItem("domos:layout:v1")),
  ).toBeNull();
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("domos:layout:v1") ?? "{}").sidebar,
      ),
    )
    .toBe(before + 40);
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  const details = page.getByRole("complementary", { name: /的详情$/ });
  await details.getByRole("button", { name: "编辑", exact: true }).click();
  const name = page.getByRole("textbox", { name: "名字", exact: true });
  await name.fill("尚未保存的名字");
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  await page.getByRole("tab", { name: "Computer", exact: true }).click();
  await page.getByRole("button", { name: "电脑设置", exact: true }).click();
  await details.getByRole("button", { name: "返回", exact: true }).click();
  await details.getByRole("tab", { name: "Bot", exact: true }).click();
  await details.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(name).toHaveValue("尚未保存的名字");
  const right = page.getByRole("separator", { name: "调整详情宽度" });
  const inspectorPanel = page.locator(
    '.workspace-panel[data-side="inspector"]',
  );
  await expect(inspectorPanel).toHaveCSS("border-inline-start-width", "1px");
  await expect(page.locator(".chat-header")).toHaveCSS(
    "border-bottom-width",
    "0px",
  );
  await expect(inspectorPanel).toHaveCSS("border-inline-start-width", "1px");
  await right.focus();
  await right.press("End");
  await expect(right).toHaveAttribute(
    "aria-valuenow",
    (await right.getAttribute("aria-valuemax")) ?? "",
  );
  expect(
    (await page.locator(".conversation").boundingBox())?.width,
  ).toBeGreaterThanOrEqual(392);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(name).toHaveValue("尚未保存的名字");
  const inspector = page.getByRole("dialog", { name: "Bot详情", exact: true });
  await expect(inspector).toHaveAttribute("aria-modal", "true");
  await page.keyboard.press("Escape");
  await expect(input).toHaveText("保留消息草稿");
  await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  await details.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(name).toHaveValue("尚未保存的名字");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.reload();
  await expect(left).toHaveAttribute("aria-valuenow", String(before + 40));
  await expect(input).toHaveText("保留消息草稿");
});

test("resizing tolerates blocked preferences and pointer cancellation", async ({
  service,
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new DOMException("Blocked", "SecurityError");
    };
    Storage.prototype.setItem = () => {
      throw new DOMException("Blocked", "SecurityError");
    };
  });
  await page.goto(service.url);
  const handle = page.getByRole("separator", { name: "调整联系人宽度" });
  await handle.press("Home");
  const min = await handle.getAttribute("aria-valuemin");
  await expect(handle).toHaveAttribute("aria-valuenow", min ?? "");
  const sidebar = page.locator('.workspace-panel[data-side="sidebar"]');
  await expect(sidebar).toHaveCSS("width", `${min}px`);
  await handle.hover();
  const box = await handle.boundingBox();
  if (!box) throw new Error("Resize handle missing");
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 180, box.y + 100);
  await expect(handle).toHaveAttribute("aria-valuenow", "276");
  await expect(page.locator(".workspace-content")).toHaveAttribute(
    "data-resizing",
    "true",
  );
  await handle.dispatchEvent("pointercancel");
  await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", min ?? "");
  await expect(page.locator(".workspace-content")).not.toHaveAttribute(
    "data-resizing",
  );
  await handle.press("ArrowRight");
  await expect
    .poll(async () => Number(await handle.getAttribute("aria-valuenow")))
    .toBeGreaterThan(Number(min));
  await expect(sidebar).toHaveCSS("width", "232px");
  await handle.hover();
  const expanded = await handle.boundingBox();
  if (!expanded) throw new Error("Resize handle missing");
  await page.mouse.move(expanded.x + expanded.width / 2, expanded.y + 100);
  await page.mouse.down();
  await expect(page.locator(".workspace-content")).toHaveAttribute(
    "data-resizing",
    "true",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".workspace-content")).not.toHaveAttribute(
    "data-resizing",
  );
  await page.mouse.up();
});

test("panel transitions preserve the transcript and draft through rapid toggles and reduced motion", async ({
  service,
  page,
}, info) => {
  test.setTimeout(60000);
  const receipt = once(service.worker, "message");
  service.worker.send({ history: 160 });
  await receipt;
  await page.setViewportSize({ width: 1620, height: 940 });
  await page.goto(service.url);
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await input.fill("保留这份草稿");
  await expect(page.locator(".message")).toHaveCount(120);
  await page.evaluate(() => {
    const frames: {
      time: number;
      visible: number;
      gap: number;
      transitions: number;
    }[] = [];
    document.documentElement.dataset.panelRecording = "true";
    const sample = (time: number) => {
      const viewport = document.querySelector<HTMLElement>(".transcript");
      if (!viewport) throw new Error("Transcript missing");
      const rect = viewport.getBoundingClientRect();
      frames.push({
        time,
        visible: Array.from(document.querySelectorAll(".message")).filter(
          (node) => {
            const row = node.getBoundingClientRect();
            return row.bottom > rect.top && row.top < rect.bottom;
          },
        ).length,
        gap: viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop,
        transitions: document
          .getAnimations()
          .filter(
            (animation) =>
              animation.effect instanceof KeyframeEffect &&
              animation.effect.pseudoElement?.includes(
                "view-transition-group",
              ) &&
              animation.effect.getTiming().duration === 220,
          ).length,
      });
      document.documentElement.dataset.panelFrames = JSON.stringify(frames);
      if (document.documentElement.dataset.panelRecording === "true")
        requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const trigger = page.getByRole("button", { name: "Bot详情", exact: true });
  const close = page
    .locator("#bot-details")
    .getByRole("button", { name: "关闭", exact: true });
  await close.click();
  for (let index = 0; index < 3; index++) {
    await trigger.click();
    await close.click();
  }
  await expect(
    page.locator(".workspace-panel[data-side=inspector]"),
  ).toBeHidden();
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          !(animation.effect instanceof KeyframeEffect) ||
          !animation.effect.pseudoElement?.includes("view-transition"),
      ),
  );
  const frames = await page.evaluate(() => {
    document.documentElement.dataset.panelRecording = "false";
    return JSON.parse(document.documentElement.dataset.panelFrames ?? "[]") as {
      time: number;
      visible: number;
      gap: number;
      transitions: number;
    }[];
  });
  expect(frames.some((frame) => frame.transitions > 0)).toBe(true);
  expect(frames.every((frame) => frame.visible > 0 && frame.gap <= 2)).toBe(
    true,
  );
  await expect(input).toHaveText("保留这份草稿");
  await expect(page.locator(".message")).toHaveCount(120);
  await writeFile(
    info.outputPath("panel-frames.json"),
    JSON.stringify(frames, null, 2),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [1360, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await trigger.click();
    const panel = page.locator(".workspace-panel[data-side=inspector]");
    await expect(panel).toBeVisible();
    expect(
      await panel.evaluate((node) => getComputedStyle(node).transitionDuration),
    ).toBe("0s");
    await page.screenshot({ path: info.outputPath(`panel-${width}.png`) });
    await panel.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(panel).toBeHidden();
    await expect(input).toHaveText("保留这份草稿");
  }
});
