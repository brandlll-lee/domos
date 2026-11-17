import { layout } from "@domos/ui/tokens";
import { expect, type FileChooser, type Page } from "@playwright/test";

export async function attachFiles(
  page: Page,
  files: Parameters<FileChooser["setFiles"]>[0],
) {
  await page.getByRole("button", { name: "添加内容", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "添加文件", exact: true }).click();
  await (await chooser).setFiles(files);
}

export async function openSettings(page: import("@playwright/test").Page) {
  if ((page.viewportSize()?.width ?? 0) < layout.sidebar.min + layout.chatMin)
    await expect(page.locator(".workspace")).toHaveAttribute(
      "data-mobile",
      "true",
    );
  else
    await expect(page.locator(".workspace")).not.toHaveAttribute("data-mobile");
  const settings = page.getByRole("main", { name: "设置", exact: true });
  if (!(await settings.isVisible())) {
    const overlay = page.locator(
      '.workspace-panel[data-side="inspector"][data-modal]',
    );
    if (await overlay.isVisible())
      await overlay.getByRole("button", { name: "关闭", exact: true }).click();
    const contacts = page.getByRole("button", { name: "联系人", exact: true });
    if (
      (page.viewportSize()?.width ?? 0) <
      layout.sidebar.min + layout.chatMin
    ) {
      await contacts.click();
    } else await expect(contacts).toHaveCount(0);
    await page.getByRole("button", { name: "用户菜单", exact: true }).click();
    await page.getByRole("menuitem", { name: "设置", exact: true }).click();
    await expect(page.locator(".settings-main")).toBeFocused();
  }
  await settings.getByRole("tab", { name: "通用", exact: true }).click();
  return settings;
}

export async function chooseAppearance(
  page: import("@playwright/test").Page,
  label: string,
) {
  const settings = page.getByRole("main", { name: "设置", exact: true });
  const opened = !(await settings.isVisible());
  await openSettings(page);
  await page.getByRole("combobox", { name: "外观", exact: true }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
  if (opened)
    await settings
      .getByRole("button", { name: "返回对话", exact: true })
      .click();
}

export async function chooseDetail(
  details: import("@playwright/test").Locator,
  label: string,
) {
  await expect(details).toBeVisible();
  if (label === "电脑") {
    await details.getByRole("tab", { name: "Computer", exact: true }).click();
    await details
      .page()
      .getByRole("button", { name: "电脑设置", exact: true })
      .click();
    return;
  }
  const back = details.getByRole("button", { name: "返回", exact: true });
  if (await back.isVisible()) await back.click();
  if (label === "身份") {
    const edit = details.getByRole("button", { name: "编辑", exact: true });
    if (await edit.count()) await edit.click();
    return;
  }
  const row = details.getByRole("button", {
    name: new RegExp(`^${label}(?:\\s|$)`),
  });
  if (await row.count()) await row.click();
}

export async function openDetails(page: import("@playwright/test").Page) {
  const details = page.getByRole("complementary", { name: /的详情$/ });
  if (!(await details.isVisible()))
    await page.getByRole("button", { name: "Bot详情", exact: true }).click();
  return details;
}

export async function expectModel(
  page: import("@playwright/test").Page,
  text: string,
) {
  const details = await openDetails(page);
  await chooseDetail(details, "运行");
  const picker = details.getByRole("combobox", { name: "模型", exact: true });
  await expect(picker).toContainText(text);
  await details.getByRole("button", { name: "关闭", exact: true }).click();
}

export async function expectTextContrast(
  page: import("@playwright/test").Page,
) {
  const ratios = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas required for color measurement");
    const luminance = (color: string) => {
      if (color) {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
      }
      const channels = [...context.getImageData(0, 0, 1, 1).data]
        .slice(0, 3)
        .map((value) => {
          const s = value / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
      const [red, green, blue] = channels;
      if (red === undefined || green === undefined || blue === undefined)
        throw new Error("Invalid computed color");
      return red * 0.2126 + green * 0.7152 + blue * 0.0722;
    };
    return [
      ...document.querySelectorAll<HTMLElement>(
        ".chat-preview span, .picker-trigger, .message-bubble, .picker-item, .message-composer-editor, .avatar-editor legend, .avatar-editor .navigation-tab, .message-material-token, .question-reply:is([aria-pressed=true], [data-selected]), .link-card-action, .media-attachment-audio",
      ),
    ].map((element) => {
      const parents: Element[] = [];
      for (
        let parent: Element | null = element;
        parent;
        parent = parent.parentElement
      )
        parents.unshift(parent);
      context.clearRect(0, 0, 1, 1);
      for (const parent of parents) {
        context.fillStyle = getComputedStyle(parent).backgroundColor;
        context.fillRect(0, 0, 1, 1);
      }
      const surface = luminance("");
      const foreground = luminance(
        getComputedStyle(
          element,
          element.matches("textarea") ? "::placeholder" : null,
        ).color,
      );
      return (
        (Math.max(foreground, surface) + 0.05) /
        (Math.min(foreground, surface) + 0.05)
      );
    });
  });
  expect(ratios.length).toBeGreaterThan(0);
  for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
}

export async function createBot(
  page: import("@playwright/test").Page,
  name: string,
  model?: string,
) {
  await expect(page.locator(".sidebar-toolbar")).toBeAttached();
  if (
    !(await page.getByRole("button", { name: "新建", exact: true }).isVisible())
  )
    await page.getByRole("button", { name: "联系人", exact: true }).click();
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page.getByRole("menuitem", { name: "新建 Bot", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建 Bot", exact: true });
  await dialog.getByLabel("名字", { exact: true }).fill(name);
  await expect(
    dialog.getByRole("textbox", { name: "HEX", exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole("combobox")).toHaveCount(0);
  await dialog.getByRole("button", { name: "创建", exact: true }).click();

  await dialog.getByRole("button", { name: "Pi", exact: true }).click();
  await dialog.getByRole("combobox", { name: "模型", exact: true }).click();
  await page
    .getByRole("option", {
      name: `Pi · ${model ?? "测试模型一"}`,
      exact: true,
    })
    .click();
  await dialog.getByRole("button", { name: "开始聊天", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("消息", { exact: true })).toHaveAttribute(
    "data-placeholder",
    `发送消息给 ${name}…`,
  );
}
