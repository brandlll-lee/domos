import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

test("plush identities load, animate and survive profile changes", async ({
  page,
}) => {
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
  try {
    const [ready] = (await once(worker, "message")) as [{ port: number }];
    await page.goto(`http://127.0.0.1:${ready.port}`);
    const brand = page.locator(".brand-mark .character");
    await expect(brand).toHaveAttribute("data-shape", "cat");
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
    const filters = await page
      .locator(".character [id]")
      .evaluateAll((items) => items.map((item) => item.id));
    expect(new Set(filters).size).toBe(filters.length);
    const brandTint = await brand
      .locator("feColorMatrix")
      .getAttribute("values");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(brand.locator("feColorMatrix")).toHaveAttribute(
      "values",
      brandTint ?? "",
    );
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(brand.locator("feColorMatrix")).toHaveAttribute(
      "values",
      brandTint ?? "",
    );
    expect(
      await brand
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
    await details
      .getByRole("button", { name: "换个形象", exact: true })
      .click();
    const next = await details.locator(".bot-avatar").getAttribute("data-seed");
    expect(next).not.toBe(initial);
    await expect(header).toHaveAttribute("data-seed", initial ?? "");
    await details
      .getByRole("button", { name: "保存身份", exact: true })
      .click();
    await expect(header).toHaveAttribute("data-seed", next ?? "");
    const identity = await header
      .locator(".character")
      .getAttribute("data-shape");
    const tint = await header.locator("feColorMatrix").getAttribute("values");
    await page.reload();
    await expect(header).toHaveAttribute("data-seed", next ?? "");
    await expect(header.locator(".character")).toHaveAttribute(
      "data-shape",
      identity ?? "",
    );
    await expect(header.locator("feColorMatrix")).toHaveAttribute(
      "values",
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
