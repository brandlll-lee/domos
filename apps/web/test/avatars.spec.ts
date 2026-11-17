import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { characterIdentity } from "@domos/ui/characters";
import { expect, test } from "@playwright/test";
import { expectTextContrast } from "./fixtures/chat-ui.ts";

test("plush identities load, animate and survive profile changes", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "domos-avatars-"));
  const worker = fork(
    fileURLToPath(
      new URL("../../api/test/fixtures/web-server.ts", import.meta.url),
    ),
    [join(directory, "data.sqlite"), "0"],
    { silent: true, execArgv: [] },
  );
  worker.stdout?.resume();
  worker.stderr?.resume();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const checkAvatarSizes = async () => {
    const sizes = await page
      .locator(".bot-avatar:visible")
      .evaluateAll((items) =>
        items.map((item) => ({
          frame: item.getBoundingClientRect().toJSON(),
          image: item.querySelector("svg")?.getBoundingClientRect().toJSON(),
        })),
      );
    expect(sizes.length).toBeGreaterThan(0);
    for (const { frame, image } of sizes) {
      expect(image?.width).toBe(frame.width);
      expect(image?.height).toBe(frame.height);
    }
  };
  try {
    const [ready] = (await once(worker, "message")) as [{ port: number }];
    await page.goto(`http://127.0.0.1:${ready.port}`);
    await expect(
      page.getByRole("button", { name: "Bot详情", exact: true }),
    ).toBeVisible();
    const avatar = page.locator(".chat-header .character");
    await checkAvatarSizes();
    const contact = page.locator('.contact-row[aria-current="page"]');
    const contactAvatar = contact.locator(".bot-avatar");
    const frame = await contactAvatar.boundingBox();
    if (!frame) throw new Error("Contact avatar required");
    await page.mouse.move(frame.x + frame.width + 150, frame.y);
    await expect
      .poll(() =>
        contactAvatar.evaluate((node) =>
          Number.parseFloat(node.style.getPropertyValue("--character-gaze-x")),
        ),
      )
      .toBeGreaterThan(0.1);
    const reads = await contactAvatar.evaluate(async (node) => {
      const measure = node.getBoundingClientRect.bind(node);
      let reads = 0;
      node.getBoundingClientRect = () => {
        reads++;
        return measure();
      };
      try {
        for (let frame = 0; frame < 12; frame++)
          await new Promise(requestAnimationFrame);
        return reads;
      } finally {
        delete (node as Partial<HTMLElement>).getBoundingClientRect;
      }
    });
    expect(reads).toBeLessThanOrEqual(1);
    await contactAvatar.hover({
      position: { x: frame.width * 0.8, y: frame.height * 0.6 },
    });
    const gesture = contactAvatar.locator(".character-gesture");
    await expect
      .poll(() =>
        gesture.evaluate(
          (node) => new DOMMatrix(getComputedStyle(node).transform).e,
        ),
      )
      .toBeGreaterThan(0.1);
    await contact.focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(() =>
        gesture.evaluate(
          (node) => new DOMMatrix(getComputedStyle(node).transform).f,
        ),
      )
      .toBeLessThan(-0.1);
    expect(await contactAvatar.boundingBox()).toEqual(frame);
    await page.getByLabel("消息", { exact: true }).fill("保存这条消息的主题");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    const bubble = page.getByLabel("你的消息").locator(".message-bubble");
    await expect(bubble).toBeVisible();
    const initialBubble = await bubble.evaluate(
      (item) => getComputedStyle(item).backgroundColor,
    );
    await page.locator(".bot-avatar").first().waitFor();
    await page.evaluate(async () => {
      await Promise.all(
        [...document.querySelectorAll(".character image")].map((element) => {
          const image = new Image();
          image.src = element.getAttribute("href") ?? "";
          return image.decode();
        }),
      );
    });
    const material = await avatar
      .locator(".character-body > image")
      .evaluate(async (node) => {
        const image = new Image();
        image.src = node.getAttribute("href") ?? "";
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas required");
        context.drawImage(image, 0, 0);
        const { data } = context.getImageData(0, 0, image.width, image.height);
        let low = 255;
        let high = 0;
        for (let index = 0; index < data.length; index += 4) {
          if (data[index + 3] !== 255) continue;
          if (
            data[index] !== data[index + 1] ||
            data[index] !== data[index + 2]
          )
            return false;
          low = Math.min(low, data[index] ?? 0);
          high = Math.max(high, data[index] ?? 0);
        }
        return high - low > 60;
      });
    expect(material).toBe(true);
    const filters = await page
      .locator(".character [id]")
      .evaluateAll((items) => items.map((item) => item.id));
    expect(new Set(filters).size).toBe(filters.length);
    const avatarTint = await avatar
      .locator("feFuncR")
      .getAttribute("tableValues");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(avatar.locator("feFuncR")).toHaveAttribute(
      "tableValues",
      avatarTint ?? "",
    );
    await page.screenshot({ path: testInfo.outputPath("identities-dark.png") });
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(avatar.locator("feFuncR")).toHaveAttribute(
      "tableValues",
      avatarTint ?? "",
    );
    await page.screenshot({
      path: testInfo.outputPath("identities-light.png"),
    });
    expect(
      await avatar
        .locator(".character-body")
        .evaluate((item) => item.getAnimations().length),
    ).toBeGreaterThan(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await page
        .locator(".character")
        .evaluateAll(
          (items) =>
            items.flatMap((item) => item.getAnimations({ subtree: true }))
              .length,
        ),
    ).toBe(0);
    const header = page.locator(".chat-header .bot-avatar");
    const initial = await header.getAttribute("data-seed");
    await page.getByRole("button", { name: "Bot详情", exact: true }).click();
    const details = page.getByRole("complementary", { name: "Domos的详情" });
    await checkAvatarSizes();
    await expect(details.locator(".bot-hero .character-gesture")).toHaveCount(
      1,
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const hero = details.locator(".bot-hero .bot-avatar");
    const heroBox = await hero.boundingBox();
    if (!heroBox) throw new Error("Profile avatar required");
    await page.mouse.move(heroBox.x - 180, heroBox.y + heroBox.height / 2);
    await expect
      .poll(() =>
        hero.evaluate((node) =>
          Number.parseFloat(node.style.getPropertyValue("--character-gaze-x")),
        ),
      )
      .toBeLessThan(-0.1);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await contactAvatar.hover();
    await expect(gesture).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    await details.getByRole("button", { name: "编辑", exact: true }).click();
    const picker = details.locator(".avatar-editor");
    await picker.getByRole("tab", { name: "内置角色", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      picker.getByRole("tab", { name: "我的角色", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      picker.getByRole("tab", { name: "我的角色", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Enter");
    await expect(picker.getByRole("button", { name: /^外形：/ })).toHaveCount(
      15,
    );
    await expect(picker.getByRole("button", { name: /^颜色：/ })).toHaveCount(
      18,
    );
    const bodies = await picker
      .locator(".character-body > image")
      .evaluateAll(async (nodes) => {
        const sources = new Set(nodes.map((node) => node.getAttribute("href")));
        return Promise.all(
          [...sources].map(async (source) => {
            const image = new Image();
            image.src = source ?? "";
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext("2d");
            if (!context) throw new Error("Canvas required");
            context.drawImage(image, 0, 0);
            const { data } = context.getImageData(
              0,
              0,
              image.width,
              image.height,
            );
            const levels: number[] = [];
            let neutral = true;
            for (let index = 0; index < data.length; index += 4) {
              if ((data[index + 3] ?? 0) <= 250) continue;
              neutral &&=
                data[index] === data[index + 1] &&
                data[index] === data[index + 2];
              levels.push(data[index] ?? 0);
            }
            levels.sort((a, b) => a - b);
            return {
              size: [image.width, image.height],
              neutral,
              median: levels[Math.floor(levels.length / 2)] ?? 0,
            };
          }),
        );
      });
    expect(bodies).toHaveLength(15);
    for (const body of bodies) {
      expect(body.size).toEqual([1120, 1120]);
      expect(body.neutral).toBe(true);
      expect(Math.abs(body.median / 255 - 0.55)).toBeLessThan(2 / 255);
    }
    await checkAvatarSizes();
    await picker.getByRole("button", { name: "换个形象", exact: true }).click();
    await picker
      .getByRole("button", { name: "外形：胶囊", exact: true })
      .click();
    await picker
      .getByRole("button", { name: "颜色：樱粉", exact: true })
      .click();
    await expect(details.locator(".avatar-preview .character")).toHaveAttribute(
      "data-shape",
      "capsule",
    );
    await picker
      .getByRole("button", { name: "外形：云团", exact: true })
      .click();
    await expect(
      picker.getByRole("button", { name: "颜色：樱粉", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await picker
      .getByRole("button", { name: "颜色：天蓝", exact: true })
      .click();
    await expect(details.locator(".avatar-preview .character")).toHaveAttribute(
      "data-shape",
      "cloud",
    );
    await page.evaluate(async () => {
      await Promise.all(
        [...document.querySelectorAll(".character image")].map((element) => {
          const image = new Image();
          image.src = element.getAttribute("href") ?? "";
          return image.decode();
        }),
      );
    });
    await page.screenshot({
      path: testInfo.outputPath("avatar-editor-light.png"),
      animations: "disabled",
    });
    await expectTextContrast(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({
      path: testInfo.outputPath("avatar-editor-dark.png"),
      animations: "disabled",
    });
    await expectTextContrast(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await checkAvatarSizes();
    await expect(async () => {
      const bounds = await picker.boundingBox();
      expect(bounds?.x).toBeGreaterThanOrEqual(0);
      expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390);
    }).toPass();
    await page.screenshot({
      path: testInfo.outputPath("avatar-editor-mobile.png"),
      animations: "disabled",
    });
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    const next = await details
      .locator(".avatar-preview > .bot-avatar")
      .getAttribute("data-seed");
    expect(next).not.toBe(initial);
    await expect(header).toHaveAttribute("data-seed", initial ?? "");
    await details
      .getByRole("button", { name: "保存身份", exact: true })
      .click();
    await expect(header).toHaveAttribute("data-seed", next ?? "");
    await expect(page.locator(".conversation")).toHaveCSS(
      "--bot-color",
      characterIdentity(next ?? "").color,
    );
    const themedBubble = await bubble.evaluate(
      (item) => getComputedStyle(item).backgroundColor,
    );
    if (
      characterIdentity(initial ?? "").color !==
      characterIdentity(next ?? "").color
    )
      expect(themedBubble).not.toBe(initialBubble);
    const identity = await header
      .locator(".character")
      .getAttribute("data-shape");
    const tint = await header.locator("feFuncR").getAttribute("tableValues");
    await page.reload();
    await expect(header).toHaveAttribute("data-seed", next ?? "");
    await expect(bubble).toHaveCSS("background-color", themedBubble);
    await checkAvatarSizes();
    await expect(header.locator(".character")).toHaveAttribute(
      "data-shape",
      identity ?? "",
    );
    await expect(header.locator("feFuncR")).toHaveAttribute(
      "tableValues",
      tint ?? "",
    );
    const icon = await page.locator('link[rel="icon"]').getAttribute("href");
    const response = await page.request.get(
      new URL(icon ?? "", page.url()).href,
    );
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("image/png");
    expect(errors).toEqual([]);
  } finally {
    worker.disconnect();
    await once(worker, "exit");
    await rm(directory, { recursive: true, force: true });
  }
});
