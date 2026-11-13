import type { ElectronApplication, Page } from "@playwright/test";
import { expect } from "@playwright/test";

export async function workspacePage(
  desktop: ElectronApplication,
  origin?: string,
) {
  let page: Page | undefined;
  await expect
    .poll(
      () => {
        page = desktop
          .context()
          .pages()
          .find(
            (page) =>
              !page.isClosed() && page.url().startsWith(origin ?? "http"),
          );
        return Boolean(page);
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  if (!page) throw new Error("Workspace page missing");
  return page;
}
