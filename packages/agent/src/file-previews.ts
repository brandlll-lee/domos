import { execFile, fork, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
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
export type OfficePreview = { kind: "pdf"; notice: string };
type Result = SpreadsheetPreview | (OfficePreview & { path: string });

export class FilePreviews {
  private readonly pending = new Map<
    string,
    { promise: Promise<Result>; controller: AbortController; readers: number }
  >();
  private queue: Promise<unknown> = Promise.resolve();

  private readonly root: string;
  constructor(root: string) {
    this.root = root;
  }

  private async converter() {
    const program =
      process.platform === "win32"
        ? "C:/Program Files/LibreOffice/program/soffice.exe"
        : process.platform === "darwin"
          ? "/Applications/LibreOffice.app/Contents/MacOS/soffice"
          : "libreoffice";
    let version: string;
    try {
      version = (
        await promisify(execFile)(program, ["--version"], {
          windowsHide: true,
          timeout: PREVIEW_TIMEOUT_MS,
        })
      ).stdout.trim();
    } catch {
      throw new Error(
        "请在这台 Domos 服务电脑上安装 LibreOffice，再重试预览。原文件仍可下载和系统打开。",
      );
    }
    const directories =
      process.platform === "win32"
        ? [
            "C:/Windows/Fonts",
            join(homedir(), "AppData/Local/Microsoft/Windows/Fonts"),
          ]
        : process.platform === "darwin"
          ? [
              "/System/Library/Fonts",
              "/Library/Fonts",
              join(homedir(), "Library/Fonts"),
            ]
          : [
              "/usr/share/fonts",
              "/usr/local/share/fonts",
              join(homedir(), ".local/share/fonts"),
            ];
    const fonts = await Promise.all(
      directories.map(async (path) => [
        path,
        (await stat(path).catch(() => null))?.mtimeMs,
      ]),
    );
    return { program, version: `${version}:${JSON.stringify(fonts)}` };
  }

  async read(
    file: Attachment,
    path: string,
    sheet: string | undefined,
    signal?: AbortSignal,
  ): Promise<Result> {
    signal?.throwIfAborted();
    const kind = filePreviewKind(file);
    if (kind !== "xlsx" && kind !== "office")
      throw new Error("此文件不需要转换预览。");
    const converter = kind === "office" ? await this.converter() : undefined;
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          file.id,
          kind,
          sheet,
          converter?.version,
          "sheetjs-0.20.3-preview-1",
        ]),
      )
      .digest("hex");
    const directory = join(this.root, "previews", key);
    const cached = join(directory, "result.json");
    const result = await readFile(cached, "utf8")
      .then((value) => JSON.parse(value) as Result)
      .catch(() => null);
    if (
      result &&
      (result.kind !== "pdf" ||
        (await access(result.path).then(
          () => true,
          () => false,
        )))
    )
      return result;
    let pending = this.pending.get(key);
    if (!pending) {
      const controller = new AbortController();
      const promise = this.queue
        .catch(() => {})
        .then(async () => {
          controller.signal.throwIfAborted();
          await mkdir(directory, { recursive: true });
          const temporary = join(directory, randomUUID());
          await mkdir(temporary);
          try {
            const generated = await this.run(
              {
                path,
                kind,
                sheet,
                output: temporary,
                converter: converter?.program,
                extension: file.name.split(".").at(-1)?.toLowerCase(),
              },
              controller.signal,
            );
            if (generated.kind === "pdf") {
              await rename(generated.path, join(directory, "preview.pdf"));
              generated.path = join(directory, "preview.pdf");
            }
            const { writeFile } = await import("node:fs/promises");
            await writeFile(
              join(temporary, "result.json"),
              JSON.stringify(generated),
            );
            await rename(join(temporary, "result.json"), cached);
            await this.clean(directory);
            return generated;
          } finally {
            await rm(temporary, { recursive: true, force: true });
          }
        });
      pending = { promise, controller, readers: 0 };
      this.pending.set(key, pending);
      this.queue = promise;
      void promise.finally(() => this.pending.delete(key)).catch(() => {});
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

  private run(
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<Result> {
    return new Promise((resolve, reject) => {
      const child = fork(
        new URL(import.meta.resolve("@domos/agent/file-preview-worker")),
        [],
        {
          execArgv: ["--max-old-space-size=256"],
          env: { ...process.env },
          stdio: ["ignore", "ignore", "ignore", "ipc"],
          detached: process.platform !== "win32",
        },
      );
      let result: Result | undefined;
      let error: Error | undefined;
      const stop = () => {
        error ??= new Error("预览已取消或超时。你仍可下载原文件。");
        if (!child.pid || child.exitCode !== null) return;
        if (process.platform === "win32")
          spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore",
          }).on("error", () => child.kill());
        else {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill();
          }
        }
      };
      const timer = setTimeout(stop, PREVIEW_TIMEOUT_MS);
      signal.addEventListener("abort", stop, { once: true });
      child.once("error", (cause) => {
        error = cause;
      });
      child.on("message", (message: { result?: Result; error?: string }) => {
        result = message.result;
        if (message.error) error = new Error(message.error);
      });
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
    for (let index = 0; index < items.length; index++) {
      const item = items[index]!;
      bytes += item.size;
      if (
        item.path !== retain &&
        (bytes > CACHE_BYTES || index >= CACHE_ENTRIES)
      )
        await rm(item.path, { recursive: true, force: true });
    }
  }
}
