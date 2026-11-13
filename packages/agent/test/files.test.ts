import { createHash } from "node:crypto";
import { once } from "node:events";
import type { ReadStream } from "node:fs";
import {
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { createRegistry } from "@earendil-works/pi-durable";
import { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";
import { strToU8, zipSync } from "fflate";
import { expect, onTestFinished, test, vi } from "vitest";
import * as XLSX from "xlsx";
import {
  FILE_CHUNK_BYTES,
  filePreviewKind,
  MAX_FILE_BYTES,
} from "../src/attachments.ts";
import { chatView } from "../src/chat-view.ts";
import { Files } from "../src/files.ts";
import { openAgent } from "../src/open-agent.ts";
import { png } from "./fixtures/png.ts";

const context = BACKGROUND_CONTEXT;

test.each([
  ["report.doc", "application/msword"],
  [
    "report.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  ["slides.ppt", "application/vnd.ms-powerpoint"],
  [
    "slides.pptx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
  ["report.doc", "application/x-cfb"],
  ["slides.ppt", "application/x-cfb"],
])("%s uses the file download fallback", (name, mimeType) => {
  expect(filePreviewKind({ name, mimeType })).toBe("download");
});

test("text attachments retain useful MIME types and binary data stays binary", async () => {
  const { files } = await setup();
  for (const [name, text, mimeType] of [
    ["说明.md", "# 你好", "text/markdown"],
    ["report.csv", 'name,value\n"one,two",001', "text/csv"],
    ["index.html", "<!doctype html><p>你好</p>", "text/html"],
    ["main.ts", "const value = 1;", "text/plain"],
    ["长文.txt", "长内容".repeat(80_000), "text/plain"],
  ] as const) {
    const file = await files.upload(1, name, new TextEncoder().encode(text));
    expect(file.mimeType).toBe(mimeType);
    await writeFile(
      join(files.root, "1", "artifacts", file.id, "metadata.json"),
      JSON.stringify({ ...file, mimeType: "application/octet-stream" }),
    );
    expect((await files.download(1, file.id)).type).toBe(mimeType);
    await expect(files.download(2, file.id)).rejects.toThrow();
  }
  const binary = await files.upload(
    1,
    "binary.html",
    new Uint8Array([0, 255, 0]),
  );
  expect(binary.mimeType).toBe("application/octet-stream");
});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "domos-files-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const files = new Files(join(directory, "agent.sqlite"));
  return { directory, files, workspace: await files.workspace(1) };
}

test("image previews retain separate thumbnail and link cover sizes", async () => {
  const { files } = await setup();
  const original = png(1000, 500);
  const file = await files.upload(1, "cover.png", original);
  const path = join(files.directory(1, file.id), "content");
  for (const width of [160, 640, 160]) {
    const result = await files.previews.read(
      file,
      path,
      undefined,
      undefined,
      width,
    );
    if (result.kind !== "image") throw new Error("Image preview required");
    expect(result.thumbnail).toMatch(/^data:image\/png;base64,/);
    const bytes = Buffer.from(result.thumbnail.split(",")[1] ?? "", "base64");
    expect(bytes.readUInt32BE(16)).toBe(width);
    expect(bytes.readUInt32BE(20)).toBe(width / 2);
  }
  expect(await readFile(path)).toEqual(original);
});

test("file capabilities reject traversal, absolute escape, junctions, hard links, and alternate streams", async () => {
  const { directory, files, workspace } = await setup();
  const outside = join(directory, "outside");
  await mkdir(outside);
  const original = crypto.randomUUID();
  await writeFile(join(outside, "source.txt"), original);
  await symlink(outside, join(workspace.cwd, "linked"), "junction");
  await link(join(outside, "source.txt"), join(workspace.cwd, "hard.txt"));
  for (const path of [
    "../escape.txt",
    join(outside, "source.txt"),
    "linked/source.txt",
    "hard.txt",
    "valid.txt:stream",
    ".. /escape.txt",
  ]) {
    expect((await workspace.absolutePath(path, context)).ok).toBe(false);
    expect((await workspace.writeFile(path, "changed", context)).ok).toBe(
      false,
    );
    expect((await workspace.readTextFile(path, context)).ok).toBe(false);
    expect(
      (await workspace.openBinaryReader(path, undefined, context)).ok,
    ).toBe(false);
    await expect(files.publish(1, path, context)).rejects.toThrow();
  }
  expect(await readFile(join(outside, "source.txt"), "utf8")).toBe(original);
  const other = await files.workspace(2);
  expect(
    (await workspace.readTextFile(join(other.cwd, "file.txt"), context)).ok,
  ).toBe(false);
});

test("file limits apply to uploaded, generated, and published files", async () => {
  const { workspace, files } = await setup();
  const bytes = new Uint8Array(MAX_FILE_BYTES + 1);
  expect((await workspace.writeFile("large.txt", bytes, context)).ok).toBe(
    false,
  );
  await expect(files.upload(1, "large.txt", bytes)).rejects.toThrow("100 MiB");
  await writeFile(join(workspace.cwd, "large.txt"), bytes);
  await expect(files.publish(1, "large.txt", context)).rejects.toThrow(
    "100 MiB",
  );
  await expect(files.upload(1, "bad:stream", new Uint8Array())).rejects.toThrow(
    "文件名无效",
  );
});

test("image reads resize to model limits, preserve originals, and retain decode diagnostics", async () => {
  const { directory, files } = await setup();
  const limits = { maxWidth: 840, maxHeight: 560, maxBytes: 500_000 };
  const faux = fauxProvider({
    models: [
      {
        id: "vision",
        input: ["text", "image"],
        inputLimits: { images: { resize: limits } },
      },
    ],
  });
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  registry.install(files.extension(await createNodePhotonImages()));
  const runtime = await openAgent(
    join(directory, "agent.sqlite"),
    {
      models,
      registry,
      env: ({ conversationId }) => files.workspace(conversationId),
    },
    { model: { provider: "faux", modelId: "vision" } },
    context,
  );
  try {
    const original = png(2700, 1800);
    const file = await files.upload(
      runtime.conversation.id,
      "photo.png",
      original,
    );
    const broken = await files.upload(
      runtime.conversation.id,
      "broken.png",
      original.subarray(0, 40),
    );
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("read", { path: file.path })], {
        stopReason: "toolUse",
      }),
      async (input) => {
        const result = input.messages.findLast(
          (message) => message.role === "toolResult",
        );
        const image = result?.content.find((part) => part.type === "image");
        expect(image?.type).toBe("image");
        if (image?.type !== "image") throw new Error("Image input missing");
        expect(image.mimeType).toBe("image/png");
        const bytes = Buffer.from(image.data, "base64");
        expect(bytes.readUInt32BE(16)).toBe(limits.maxWidth);
        expect(bytes.readUInt32BE(20)).toBe(limits.maxHeight);
        expect(image.data.length).toBeLessThanOrEqual(limits.maxBytes);
        return fauxAssistantMessage(
          [fauxToolCall("read", { path: broken.path })],
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage("Image read checked"),
    ]);
    const submission = await runtime.conversation.submit(
      { type: "input", content: "Read both images" },
      context,
    );
    await submission.wait(context);
    const workspace = await files.workspace(runtime.conversation.id);
    expect(await readFile(join(workspace.cwd, file.path))).toEqual(original);
    const state = await runtime.conversation.viewState(context);
    try {
      const results = chatView(state.value).messages.filter(
        (message) => message.role === "toolResult",
      );
      expect(results).toHaveLength(2);
      expect(results[0]?.isError).toBe(false);
      expect(results[0]?.diagnostics?.length).toBeGreaterThan(0);
      expect(results[1]?.isError).toBe(true);
      expect(
        results[1]?.diagnostics?.some((item) => item.severity === "error"),
      ).toBe(true);
    } finally {
      state.dispose();
    }
  } finally {
    await runtime.harness.close(context);
  }
});

test("streamed files keep bytes, allow binary publication, enforce message totals, and clean cancelled uploads", async () => {
  const { files, workspace } = await setup();
  const chunk = Buffer.alloc(512 * 1024, 43);
  async function* chunks(count: number) {
    for (let i = 0; i < count; i++) yield chunk;
  }
  const file = await files.uploadStream(
    1,
    "large.bin",
    chunks(MAX_FILE_BYTES / chunk.length),
  );
  expect(file.size).toBe(MAX_FILE_BYTES);
  expect((await workspace.readTextFile(file.path, context)).ok).toBe(false);
  const published = await files.publish(1, file.path, context);
  const hash = createHash("sha256");
  const { body } = await files.stream(1, published.id);
  for await (const bytes of Readable.fromWeb(
    body as import("node:stream/web").ReadableStream<Uint8Array>,
  ))
    hash.update(bytes);
  const expected = createHash("sha256");
  for (let i = 0; i < MAX_FILE_BYTES / chunk.length; i++)
    expected.update(chunk);
  expect(hash.digest("hex")).toBe(expected.digest("hex"));
  await expect(files.verify(1, [file, file, file], context)).rejects.toThrow(
    "250 MiB",
  );
  await files.verify(1, [file, file], context);
  const half = await files.uploadStream(
    1,
    "half.bin",
    chunks(MAX_FILE_BYTES / chunk.length / 2),
  );
  await files.verify(1, [file, file, half], context);
  async function* plusOne() {
    yield* chunks(MAX_FILE_BYTES / chunk.length / 2);
    yield new Uint8Array([1]);
  }
  const excess = await files.uploadStream(1, "excess.bin", plusOne());
  await expect(files.verify(1, [file, file, excess], context)).rejects.toThrow(
    "250 MiB",
  );
  await expect(files.verify(1, Array(11).fill(half), context)).rejects.toThrow(
    "10",
  );
  const controller = new AbortController();
  async function* interrupted() {
    yield chunk;
    controller.abort();
    yield chunk;
  }
  await expect(
    files.uploadStream(
      1,
      "cancelled.bin",
      interrupted(),
      withAbortSignal(controller.signal, context),
    ),
  ).rejects.toThrow();
  expect(await readdir(join(files.root, ".incoming"))).toEqual([]);
  const shared = await files.share(1, 2, [file.id], "stream-share", context);
  expect(shared[0]?.size).toBe(file.size);
}, 30_000);

test("spreadsheet preview selects sheets, retains formatted cached values, and rejects expanded ZIPs", async () => {
  const { files } = await setup();
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["名称", "比例", "日期", "公式缓存"],
    ["中文", 0.25, 45292, 42],
  ]);
  sheet.B2 = { ...sheet.B2, z: "0%" };
  sheet.C2 = { ...sheet.C2, z: "yyyy-mm-dd" };
  sheet.D2 = { ...sheet.D2, f: "SUM(40,2)" };
  XLSX.utils.book_append_sheet(book, sheet, "汇总");
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([["第二张表"]]),
    "明细",
  );
  const file = await files.upload(
    1,
    "数据.xlsx",
    XLSX.write(book, { type: "buffer", bookType: "xlsx" }),
  );
  const path = join(files.directory(1, file.id), "content");
  const controller = new AbortController();
  const cancelled = files.previews.read(
    file,
    path,
    undefined,
    controller.signal,
  );
  const reading = files.previews.read(file, path, undefined);
  controller.abort();
  await expect(cancelled).rejects.toThrow();
  const result = await reading;
  expect(result.kind).toBe("xlsx");
  if (result.kind !== "xlsx") throw new Error("Spreadsheet required");
  expect(result.sheets).toEqual(["汇总", "明细"]);
  expect(result.rows[1]).toEqual(["中文", "25%", "2024-01-01", "42"]);
  expect(await files.previews.read(file, path, undefined)).toEqual(result);
  const next = await files.previews.read(file, path, "明细");
  if (next.kind !== "xlsx") throw new Error("Spreadsheet required");
  expect(next.rows[0]).toEqual(["第二张表"]);
  await expect(files.previews.read(file, path, "missing")).rejects.toThrow(
    "工作表不存在",
  );
  const bomb = await files.upload(
    1,
    "expanded.xlsx",
    zipSync({
      "xl/worksheets/sheet1.xml": new Uint8Array(129 * 1024 * 1024),
      "[Content_Types].xml": strToU8("<Types/>"),
    }),
  );
  await expect(
    files.previews.read(
      { ...bomb, mimeType: file.mimeType },
      join(files.directory(1, bomb.id), "content"),
      undefined,
    ),
  ).rejects.toThrow("解压后超过预览预算");
}, 30_000);

test("file downloads pause disk reads while the client does not read", async () => {
  const { files } = await setup();
  const chunk = Buffer.alloc(FILE_CHUNK_BYTES);
  async function* chunks() {
    for (let index = 0; index < 32; index++) yield chunk;
  }
  const file = await files.uploadStream(1, "data.bin", chunks());
  const adapter = vi.spyOn(Readable, "toWeb");
  const { body } = await files.stream(1, file.id);
  const source = adapter.mock.calls[0]?.[0] as ReadStream;
  adapter.mockRestore();
  try {
    await once(source, "pause");
    expect(source.bytesRead).toBeLessThanOrEqual(FILE_CHUNK_BYTES * 3);
  } finally {
    await body.cancel();
  }
});
