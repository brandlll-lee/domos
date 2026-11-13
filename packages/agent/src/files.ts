import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, posix, resolve, win32 } from "node:path";
import { Readable } from "node:stream";
import type { Context } from "@earendil-works/chord/context";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import {
  type Conversation,
  type Cursor,
  defineExtension,
  defineTool,
  section,
} from "@earendil-works/pi-durable";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import {
  createEditTool,
  createReadTool,
  createWriteTool,
  type ImageProcessor,
} from "@earendil-works/pi-durable/tools";
import { fileTypeFromBuffer, fileTypeFromFile } from "file-type";
import {
  type Attachment,
  type EvidenceSource,
  FILE_CHUNK_BYTES,
  type FileCategory,
  fileCategory,
  MAX_ATTACHMENTS,
  MAX_FILE_BYTES,
  MAX_MESSAGE_FILE_BYTES,
  textFileType,
} from "./attachments.ts";
import { chatView } from "./chat-view.ts";
import { owningBot } from "./conversations.ts";
import { FilePreviews } from "./file-previews.ts";
import { LinkPreviews } from "./link-previews.ts";
import { WorkError } from "./work/state.ts";
import { type WorkEnvironment, Workspace } from "./workspace.ts";

export type { SpreadsheetPreview } from "./file-previews.ts";

export type ConversationFile = {
  file: Attachment;
  messageId: string;
  cursor?: string;
  timestamp?: number;
};

export async function conversationFiles(
  conversation: Conversation,
  query: string,
  offset: number,
  limit: number,
  context: Context,
  category: FileCategory = "all",
) {
  const items: ConversationFile[] = [];
  const seen = new Set<string>();
  const search = query.trim().toLocaleLowerCase();
  let cursor: Cursor | undefined;
  let matched = 0;
  do {
    const batch = await conversation.entries(
      { order: "descending" },
      200,
      cursor,
      context,
    );
    const view = chatView({
      conversation,
      entries: [...batch.items].reverse(),
      docs: {},
    });
    for (const message of view.messages.reverse()) {
      if (
        message.hidden ||
        message.pending ||
        message.stopped ||
        message.isError
      )
        continue;
      for (const file of message.attachments ?? []) {
        if (seen.has(file.id)) continue;
        seen.add(file.id);
        if (category !== "all" && fileCategory(file) !== category) continue;
        if (!file.name.toLocaleLowerCase().includes(search)) continue;
        if (matched++ < offset) continue;
        if (items.length === limit) return { items, next: offset + limit };
        items.push({
          file,
          messageId: message.id,
          cursor: message.cursor,
          timestamp: message.timestamp,
        });
      }
    }
    cursor = batch.next;
  } while (cursor);
  return { items, next: null };
}

export const FileInput = "domos.file-input";

export class Files {
  readonly root: string;
  readonly previews: FilePreviews;
  readonly links: LinkPreviews;
  private readonly operations = new Map<number, Promise<unknown>>();
  private readonly target?: (
    botId: number,
    context: Context,
  ) => Promise<string | null>;
  private readonly attachmentComputerId?: (
    context: Context,
  ) => Promise<string | null>;
  private readonly environment:
    | ((
        botId: number,
        context: Context,
        directory?: string | null,
      ) => Promise<WorkEnvironment>)
    | undefined;

  constructor(
    database: string,
    environment?: (
      botId: number,
      context: Context,
      directory?: string | null,
    ) => Promise<WorkEnvironment>,
    target?: (botId: number, context: Context) => Promise<string | null>,
    attachmentComputerId?: (context: Context) => Promise<string | null>,
  ) {
    this.root = resolve(`${database}.files`);
    this.previews = new FilePreviews(this.root);
    this.links = new LinkPreviews(this.root, this.previews);
    this.environment = environment;
    this.target = target;
    this.attachmentComputerId = attachmentComputerId;
  }

  async workspace(
    botId: number,
    context = BACKGROUND_CONTEXT,
    directory?: string | null,
  ) {
    if (this.environment) return this.environment(botId, context, directory);
    const cwd = directory ?? join(this.root, String(botId), "workspace");
    await mkdir(cwd, { recursive: true });
    return new Workspace({ cwd });
  }

  async exclusive<T>(botId: number, action: () => Promise<T>): Promise<T> {
    const previous = this.operations.get(botId) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(action);
    this.operations.set(botId, pending);
    try {
      return await pending;
    } finally {
      if (this.operations.get(botId) === pending) this.operations.delete(botId);
    }
  }

  directory(botId: number, id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid file ID");
    return join(this.root, String(botId), "artifacts", id);
  }

  private async stage(chunks: AsyncIterable<Uint8Array>, context: Context) {
    const directory = join(this.root, ".incoming");
    await mkdir(directory, { recursive: true });
    const path = join(directory, randomUUID());
    const handle = await open(path, "wx");
    const hash = createHash("sha256");
    let size = 0;
    try {
      for await (const chunk of chunks) {
        context.abortSignal?.throwIfAborted();
        size += chunk.byteLength;
        if (size > MAX_FILE_BYTES)
          throw new WorkError("BAD_REQUEST", "文件大小超过 100 MiB。");
        hash.update(chunk);
        await handle.writeFile(chunk);
      }
      return { path, size, digest: hash.digest("hex") };
    } catch (error) {
      await handle.close();
      await rm(path, { force: true });
      throw error;
    } finally {
      await handle.close();
    }
  }

  private async storeStream(
    botId: number,
    path: string,
    chunks: AsyncIterable<Uint8Array>,
    context: Context,
    computerId?: string,
    source?: EvidenceSource,
    uploadId?: string,
    workspace?: string,
  ): Promise<Attachment> {
    const staged = await this.stage(chunks, context);
    return this.commitStaged(
      botId,
      path,
      staged,
      computerId,
      source,
      uploadId,
      workspace,
    );
  }

  private async commitStaged(
    botId: number,
    path: string,
    staged: { path: string; size: number },
    computerId?: string,
    source?: EvidenceSource,
    uploadId?: string,
    workspace?: string,
  ): Promise<Attachment> {
    try {
      const hash = createHash("sha256").update(path).update("\0");
      for await (const chunk of createReadStream(staged.path))
        hash.update(chunk);
      const id = hash
        .update(computerId ?? "")
        .update(workspace ?? "")
        .digest("hex");
      const head = await open(staged.path, "r");
      const bytes = Buffer.alloc(Math.min(staged.size, FILE_CHUNK_BYTES));
      try {
        await head.read(bytes, 0, bytes.length, 0);
      } finally {
        await head.close();
      }
      const mimeType =
        (await fileTypeFromFile(staged.path).catch(() => undefined))?.mime ??
        textFileType(path, bytes, bytes.length === staged.size) ??
        "application/octet-stream";
      const file: Attachment = {
        id,
        name: basename(path),
        size: staged.size,
        path,
        mimeType,
        ...(computerId ? { computerId } : {}),
        ...(source ? { source } : {}),
        ...(uploadId ? { uploadId } : {}),
        ...(workspace ? { directory: workspace } : {}),
      };
      const directory = this.directory(botId, id);
      await mkdir(directory, { recursive: true });
      await rename(staged.path, join(directory, "content"));
      const metadata = join(directory, randomUUID());
      try {
        await writeFile(metadata, JSON.stringify(file));
        await rename(metadata, join(directory, "metadata.json"));
      } finally {
        await rm(metadata, { force: true });
      }
      return file;
    } finally {
      await rm(staged.path, { force: true });
    }
  }

  private store(
    botId: number,
    path: string,
    bytes: Uint8Array,
    computerId?: string,
    source?: EvidenceSource,
  ) {
    return this.storeStream(
      botId,
      path,
      Readable.from([bytes]),
      BACKGROUND_CONTEXT,
      computerId,
      source,
    );
  }

  upload(
    botId: number,
    name: string,
    bytes: Uint8Array,
    context = BACKGROUND_CONTEXT,
    uploadId: string = randomUUID(),
  ) {
    return this.uploadStream(
      botId,
      name,
      Readable.from([bytes]),
      context,
      uploadId,
    );
  }

  async uploadStream(
    botId: number,
    name: string,
    chunks: AsyncIterable<Uint8Array>,
    context = BACKGROUND_CONTEXT,
    uploadId: string = randomUUID(),
  ) {
    const filename = basename(win32.basename(name)).trim();
    if (
      !filename ||
      filename === "." ||
      filename === ".." ||
      [...filename].some(
        (character) => character.charCodeAt(0) < 32 || character === ":",
      )
    )
      throw new WorkError("BAD_REQUEST", `${name}：文件名无效。`);
    if (!/^[a-f0-9-]{36}$/i.test(uploadId))
      throw new WorkError("BAD_REQUEST", "上传 ID 无效。");
    const staged = await this.stage(chunks, context);
    let temporary: string | undefined;
    let workspace: WorkEnvironment | undefined;
    try {
      const type = await fileTypeFromFile(staged.path).catch(() => undefined);
      if (
        type?.mime.startsWith("image/") &&
        !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
          type.mime,
        )
      )
        throw new WorkError(
          "BAD_REQUEST",
          `${filename}：不支持 ${type.mime}。请使用 PNG、JPEG、WebP 或 GIF。`,
        );
      const filePath = `uploads/${uploadId}/${staged.digest}/${filename}`;
      workspace = await this.workspace(botId, context);
      const path = await workspace.path(filePath);
      const parent = getOrThrow(
        await workspace.joinPath([path, ".."], context),
      );
      getOrThrow(
        await workspace.createDir(parent, { recursive: true }, context),
      );
      temporary = getOrThrow(
        await workspace.joinPath([parent, randomUUID()], context),
      );
      getOrThrow(
        await workspace.writeFile(temporary, new Uint8Array(), context),
      );
      for await (const chunk of createReadStream(staged.path, {
        highWaterMark: FILE_CHUNK_BYTES,
      })) {
        context.abortSignal?.throwIfAborted();
        getOrThrow(await workspace.appendFile(temporary, chunk, context));
      }
      context.abortSignal?.throwIfAborted();
      getOrThrow(await workspace.renameFile(temporary, path, context));
      try {
        return await this.commitStaged(
          botId,
          filePath,
          staged,
          (await this.target?.(botId, context)) ?? undefined,
          undefined,
          uploadId,
          workspace.cwd,
        );
      } catch (error) {
        await workspace.remove(path, { force: true }, BACKGROUND_CONTEXT);
        throw error;
      }
    } finally {
      await rm(staged.path, { force: true });
      if (temporary && workspace)
        await workspace.remove(temporary, { force: true }, BACKGROUND_CONTEXT);
    }
  }

  async stream(
    botId: number,
    id: string,
    range?: { start: number; end: number },
  ) {
    const file = await this.metadata(botId, id);
    return {
      file,
      body: Readable.toWeb(
        createReadStream(join(this.directory(botId, id), "content"), range),
      ) as ReadableStream<Uint8Array>,
    };
  }

  async discard(botId: number, id: string) {
    const file = (await this.metadata(botId, id).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    })) as (Attachment & { uploadId?: string }) | null;
    if (!file?.uploadId) return;
    const computerId = await this.target?.(botId, BACKGROUND_CONTEXT);
    if (!this.target || computerId === file.computerId) {
      const workspace = await this.workspace(
        botId,
        BACKGROUND_CONTEXT,
        file.directory ?? null,
      );
      const path = file.directory
        ? (file.directory.startsWith("/") ? posix : win32).resolve(
            file.directory,
            file.path,
          )
        : file.path;
      getOrThrow(
        await workspace.remove(
          await workspace.path(path),
          { force: true },
          BACKGROUND_CONTEXT,
        ),
      );
    }
    await rm(this.directory(botId, id), { recursive: true, force: true });
  }

  async metadata(botId: number, id: string): Promise<Attachment> {
    const file: Attachment = JSON.parse(
      await readFile(join(this.directory(botId, id), "metadata.json"), "utf8"),
    );
    if (!file.mimeType || file.mimeType === "application/octet-stream") {
      const path = join(this.directory(botId, id), "content");
      const handle = await open(path, "r");
      const bytes = Buffer.alloc(Math.min(file.size, FILE_CHUNK_BYTES));
      try {
        await handle.read(bytes, 0, bytes.length, 0);
      } finally {
        await handle.close();
      }
      file.mimeType =
        (await fileTypeFromFile(path).catch(() => undefined))?.mime ??
        textFileType(file.name, bytes, bytes.length === file.size) ??
        "application/octet-stream";
      await writeFile(
        join(this.directory(botId, id), "metadata.json"),
        JSON.stringify(file),
      );
    }
    return file;
  }

  async download(botId: number, id: string) {
    const file = await this.metadata(botId, id);
    const bytes = await readFile(join(this.directory(botId, id), "content"));
    return new File([bytes], file.name, { type: file.mimeType });
  }

  async images(
    botId: number,
    attachments: readonly Attachment[],
    context: Context,
  ) {
    await this.verify(botId, attachments, context);
    const images = [];
    for (const attachment of attachments) {
      const file = await this.download(botId, attachment.id);
      if (!file.type.startsWith("image/")) continue;
      if (
        !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
          file.type,
        )
      )
        throw new Error(
          `${attachment.name}：图片格式 ${file.type} 暂不支持。请转换为 PNG、JPEG、WebP 或 GIF。`,
        );
      images.push({
        type: "image" as const,
        data: Buffer.from(await file.arrayBuffer()).toString("base64"),
        mimeType: file.type,
      });
    }
    return images;
  }

  async verify(
    botId: number,
    attachments: readonly Attachment[],
    context: Context,
  ) {
    if (attachments.length > MAX_ATTACHMENTS)
      throw new WorkError(
        "BAD_REQUEST",
        `最多添加 ${MAX_ATTACHMENTS} 个文件。`,
      );
    const saved = await Promise.all(
      attachments.map((file) => this.metadata(botId, file.id)),
    );
    if (
      saved.some((file) => file.size > MAX_FILE_BYTES) ||
      saved.reduce((total, file) => total + file.size, 0) >
        MAX_MESSAGE_FILE_BYTES
    )
      throw new WorkError(
        "BAD_REQUEST",
        "每条消息的附件合计不能超过 250 MiB。",
      );
    if (!this.target || !attachments.length) return;
    const computerId = await this.target(botId, context);
    if (!computerId) throw new Error("请先为 Bot 分配电脑，再处理附件。");
    const attachmentComputerId = await this.attachmentComputerId?.(context);
    if (
      attachments.some(
        (file) => (file.computerId ?? attachmentComputerId) !== computerId,
      )
    )
      throw new Error("附件属于另一台电脑。请在当前电脑上重新上传。");
    for (const file of attachments) {
      const source = await this.metadata(botId, file.id);
      const directory =
        source.directory ?? (await this.workspace(botId, context, null)).cwd;
      file.path = (directory.startsWith("/") ? posix : win32).resolve(
        directory,
        source.path,
      );
    }
  }

  async share(
    source: number,
    recipient: number,
    ids: readonly string[],
    requestId: string,
    context: Context,
  ) {
    return Promise.all(
      [...new Set(ids)].map(async (id) => {
        const file = await this.metadata(source, id);
        const hash = createHash("sha256")
          .update(`${requestId}:${id}`)
          .digest("hex")
          .slice(0, 32);
        const uploadId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
        return this.uploadStream(
          recipient,
          file.name,
          createReadStream(join(this.directory(source, id), "content")),
          context,
          uploadId,
        );
      }),
    );
  }

  async publish(botId: number, path: string, context: Context) {
    const workspace = await this.workspace(botId, context);
    const resolved = await workspace.path(path);
    const reader = await workspace.openBinaryReader(
      resolved,
      undefined,
      context,
    );
    if (!reader.ok) throw reader.error;
    const opened = reader.value;
    try {
      const info = await reader.value.info(context);
      if (!info.ok) throw info.error;
      if (info.value.kind !== "file")
        throw new Error("Only files can be attached");
      if (info.value.size > MAX_FILE_BYTES)
        throw new Error("File exceeds 100 MiB");
      const size = info.value.size;
      async function* chunks() {
        for (let offset = 0; offset < size; offset += FILE_CHUNK_BYTES) {
          yield getOrThrow(
            await opened.read(
              offset,
              Math.min(FILE_CHUNK_BYTES, size - offset),
              context,
            ),
          );
        }
      }
      return await this.storeStream(
        botId,
        (resolved.startsWith("/") ? posix : win32)
          .relative(workspace.cwd, resolved)
          .replaceAll("\\", "/"),
        chunks(),
        context,
        (await this.target?.(botId, context)) ?? undefined,
        undefined,
        undefined,
        workspace.cwd,
      );
    } finally {
      await reader.value.close(context);
    }
  }

  async capture(
    botId: number,
    bytes: Uint8Array,
    source: EvidenceSource,
    context: Context,
  ) {
    const type = await fileTypeFromBuffer(bytes);
    if (!type?.mime.startsWith("image/"))
      throw new Error("截图不是有效的图片。");
    return this.store(
      botId,
      `evidence/${randomUUID()}.${type.ext}`,
      bytes,
      (await this.target?.(botId, context)) ?? undefined,
      source,
    );
  }

  extension(images?: ImageProcessor) {
    const files = this;
    return defineExtension({
      name: "domos-files",
      tools: [
        ...[
          createReadTool({ images }),
          createWriteTool(),
          createEditTool(),
        ].map((tool) => ({ ...tool, executionMode: "sequential" as const })),
        defineTool({
          name: "attach_file",
          description:
            "Deliver a requested file to the user. Provide a workspace path or the exact saved screenshot id. For an interactive chart, calculator or page, write one self-contained HTML file with inline CSS and JavaScript, then use display: inline. It runs without network, cookies, storage, Node or host access. Use the provided --color-text, --color-muted, --color-surface, --color-border and --font-sans CSS variables, fluid width, and no outer card or banner title. Ordinary files omit display. Evidence archive paths are not workspace files. Routine screenshot evidence is already saved; attach it only when the user requests image delivery.",
          parameters: Type.Object({
            path: Type.Optional(Type.String()),
            id: Type.Optional(Type.String()),
            display: Type.Optional(Type.Literal("inline")),
          }),
          executionMode: "sequential",
          async execute(args, api, context) {
            let file: Attachment;
            if (args.id !== undefined && args.path === undefined) {
              file = await files.metadata(
                await owningBot(api, api.conversationId, context),
                args.id,
              );
              await files.verify(
                await owningBot(api, api.conversationId, context),
                [file],
                context,
              );
            } else if (args.path !== undefined && args.id === undefined) {
              file = await files.publish(
                await owningBot(api, api.conversationId, context),
                args.path,
                context,
              );
            } else {
              throw new Error(
                "Provide either a workspace path or a saved screenshot id.",
              );
            }
            if (args.display) {
              if (file.mimeType !== "text/html")
                throw new Error("Only HTML files support inline display.");
              file = { ...file, display: args.display };
            }
            return {
              output: [
                {
                  type: "text",
                  text: `Attached ${file.name} (${file.size} bytes)`,
                },
              ],
              details: { attachment: file },
            };
          },
        }),
      ],
      sections: [
        section("workspace", ({ env }) =>
          env
            ? "File paths are relative to this Bot's working directory on the selected computer. Bots sharing a computer share its OS permissions. Read uploaded text files with read. Create or edit deliverables with write/edit, then publish them with attach_file. Published files are durable snapshots, available even when the work computer is stopped. Do not claim to process unsupported file formats."
            : undefined,
        ),
      ],
    });
  }
}
