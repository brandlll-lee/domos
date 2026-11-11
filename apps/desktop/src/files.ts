import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { MAX_FILE_BYTES } from "@domos/agent/attachments";
import { app, type BrowserWindow, dialog, shell } from "electron";
import { z } from "zod";

export async function desktopFile(
  window: BrowserWindow,
  origin: string,
  input: unknown,
) {
  const value = z
    .object({
      action: z.enum(["open", "reveal", "save"]),
      botId: z.number().int().nonnegative(),
      id: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .parse(input);
  const url = new URL(`/files/${value.botId}/${value.id}?download=1`, origin);
  const controller = new AbortController();
  const close = () => controller.abort();
  window.once("closed", close);
  let response: Response | undefined;
  let temporary: string | undefined;
  try {
    response = await window.webContents.session.fetch(url.href, {
      signal: controller.signal,
      credentials: "include",
    });
    if (!response.ok || !response.body)
      throw new Error("文件读取失败。请检查工作电脑连接后重试。");
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(
      response.headers.get("Content-Disposition") ?? "",
    )?.[1];
    const name = basename(decodeURIComponent(encoded ?? "文件")).replace(
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Operating-system filenames cannot contain control characters.
      /[<>:"/\\|?*\x00-\x1f]/g,
      "_",
    );
    let target: string;
    if (value.action === "save") {
      const selected = await dialog.showSaveDialog(window, {
        defaultPath: name,
      });
      if (selected.canceled || !selected.filePath) return { cancelled: true };
      target = selected.filePath;
    } else {
      const computer = createHash("sha256")
        .update(new URL(origin).origin)
        .digest("hex");
      target = join(
        app.getPath("temp"),
        "Domos",
        "files",
        computer,
        String(value.botId),
        value.id,
        name,
      );
    }
    await mkdir(dirname(target), { recursive: true });
    temporary = join(dirname(target), `.${randomUUID()}.download`);
    let size = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        callback(
          size > MAX_FILE_BYTES ? new Error("文件大小超过 100 MiB。") : null,
          chunk,
        );
      },
    });
    await pipeline(
      Readable.fromWeb(
        response.body as import("node:stream/web").ReadableStream<Uint8Array>,
      ),
      limit,
      createWriteStream(temporary, { flags: "wx" }),
      { signal: controller.signal },
    );
    await rename(temporary, target);
    if (value.action === "open") {
      const error = await shell.openPath(target);
      if (error) throw new Error(error);
    } else if (value.action === "reveal") shell.showItemInFolder(target);
    return { cancelled: false, localCopy: true };
  } finally {
    window.removeListener("closed", close);
    controller.abort();
    if (temporary) await rm(temporary, { force: true });
  }
}
