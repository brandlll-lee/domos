import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Attachment } from "./attachments.ts";
import { filePreviewKind } from "./attachments.ts";

const PREVIEW_TIMEOUT_MS = 30_000;
const CACHE_BYTES = 512 * 1024 * 1024;
const CACHE_ENTRIES = 100;
export type SpreadsheetPreview = {
  kind: "xlsx";
  sheets: string[];
  sheet: string;
  rows: string[][];
  rowLimit: number;
  columnLimit: number;
};

type FilePreview =
  | SpreadsheetPreview
  | {
      kind: "image";
      thumbnail: string;
      width: number;
      height: number;
      frames: number;
    };

export class FilePreviews {
  private readonly pending = new Map<
    string,
    {
      promise: Promise<FilePreview>;
      controller: AbortController;
      readers: number;
    }
  >();
  private queue: Promise<unknown> = Promise.resolve();

  private readonly root: string;
  constructor(root: string) {
    this.root = root;
  }

  async read(
    file: Attachment,
    path: string,
    sheet: string | undefined,
    signal?: AbortSignal,
    width = 160,
  ): Promise<FilePreview> {
    signal?.throwIfAborted();
    if (!Number.isInteger(width) || width < 1 || width > 960)
      throw new Error("缩略图尺寸必须介于 1 至 960 像素。");
    const kind = filePreviewKind(file);
    if (kind !== "xlsx" && kind !== "image")
      throw new Error("此格式暂不支持预览，请下载后使用本机应用打开。");
    const implementation = createHash("sha256")
      .update(
        await readFile(
          new URL(import.meta.resolve("@domos/agent/file-preview-worker")),
        ),
      )
      .update(
        await readFile(new URL("./package.json", import.meta.resolve("xlsx"))),
      )
      .digest("hex");
    const key = createHash("sha256")
      .update(JSON.stringify([file.id, kind, sheet, implementation, width]))
      .digest("hex");
    const directory = join(this.root, "previews", key);
    const cached = join(directory, "result.json");
    const result = await readFile(cached, "utf8")
      .then((value) => JSON.parse(value) as FilePreview)
      .catch(() => null);
    if (result) return result;
    signal?.throwIfAborted();
    let pending = this.pending.get(key);
    if (pending?.controller.signal.aborted) pending = undefined;
    if (!pending) {
      const controller = new AbortController();
      const promise = this.queue
        .catch(() => {})
        .then(async () => {
          controller.signal.throwIfAborted();
          await mkdir(directory, { recursive: true });
          const generated = await this.run(
            { path, sheet, kind, mimeType: file.mimeType, width },
            controller.signal,
          );
          await writeFile(`${cached}.tmp`, JSON.stringify(generated));
          await rename(`${cached}.tmp`, cached);
          await this.clean(directory);
          return generated;
        });
      pending = { promise, controller, readers: 0 };
      this.pending.set(key, pending);
      this.queue = promise;
      void promise
        .finally(() => {
          if (this.pending.get(key)?.promise === promise)
            this.pending.delete(key);
        })
        .catch(() => {});
    }
    const current = pending;
    current.readers++;
    let release: () => void = () => {};
    try {
      return await Promise.race([
        current.promise,
        new Promise<never>((_, reject) => {
          const abort = () =>
            reject(signal?.reason ?? new Error("预览已取消。"));
          signal?.addEventListener("abort", abort, { once: true });
          release = () => signal?.removeEventListener("abort", abort);
          if (signal?.aborted) abort();
        }),
      ]);
    } finally {
      release();
      if (--current.readers === 0 && this.pending.get(key) === current)
        current.controller.abort();
    }
  }

  clear() {
    const clearing = this.queue
      .catch(() => {})
      .then(async () => {
        const path = join(this.root, "previews");
        await rm(path, { recursive: true, force: true });
      });
    this.queue = clearing;
    return clearing;
  }

  private run(
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<FilePreview> {
    return new Promise((resolve, reject) => {
      const child = fork(
        new URL(import.meta.resolve("@domos/agent/file-preview-worker")),
        [],
        {
          execArgv: ["--max-old-space-size=256"],
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
          stdio: ["ignore", "ignore", "ignore", "ipc"],
        },
      );
      let result: FilePreview | undefined;
      let error: Error | undefined;
      const stop = () => {
        error ??= new Error("预览已取消或超时。你仍可下载原文件。");
        if (!child.pid || child.exitCode !== null) return;
        child.kill();
      };
      const timer = setTimeout(stop, PREVIEW_TIMEOUT_MS);
      signal.addEventListener("abort", stop, { once: true });
      child.once("error", (cause) => {
        error = cause;
      });
      child.on(
        "message",
        (message: { result?: FilePreview; error?: string }) => {
          result = message.result;
          if (message.error) error = new Error(message.error);
        },
      );
      child.once("close", () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", stop);
        if (error || !result)
          reject(
            error ??
              new Error("预览进程未完成。文件可能已损坏、加密或超过内存预算。"),
          );
        else resolve(result);
      });
      child.send(input);
      if (signal.aborted) stop();
    });
  }

  private async clean(retain: string) {
    const root = dirname(retain);
    const items = await Promise.all(
      (await readdir(root)).map(async (name) => {
        const path = join(root, name);
        const info = await stat(path);
        const entries = await readdir(path, { withFileTypes: true });
        const size = (
          await Promise.all(
            entries
              .filter((entry) => entry.isFile())
              .map((entry) => stat(join(path, entry.name))),
          )
        ).reduce((sum, file) => sum + file.size, 0);
        return { path, time: info.mtimeMs, size };
      }),
    );
    items.sort((a, b) => b.time - a.time);
    let bytes = 0;
    for (const [index, item] of items.entries()) {
      bytes += item.size;
      if (
        item.path !== retain &&
        (bytes > CACHE_BYTES || index >= CACHE_ENTRIES)
      )
        await rm(item.path, { recursive: true, force: true });
    }
  }
}
